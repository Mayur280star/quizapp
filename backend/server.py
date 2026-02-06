"""
Quiz Arena Backend - Production-Ready Version
Complete implementation with proper error handling, WebSocket management, and state synchronization
"""

from fastapi import (
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    Query,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Set, Any, Union
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from collections import defaultdict
import os
import logging
import uuid
import random
import string
import asyncio
import json

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================


class Config:
    MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    DB_NAME = os.getenv("DB_NAME", "quiz_arena")
    MAX_REQUESTS_PER_MINUTE = 300
    MAX_QUIZ_QUESTIONS = 100
    MAX_PARTICIPANTS = 1000
    SESSION_TIMEOUT_MIN = 30
    WS_HEARTBEAT_SEC = 25
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "https://*",  # Allow all HTTPS origins for production
    ]


config = Config()

# Global state
mongo_client = None
db = None
manager = None
rate_limiter = None

# ============================================================================
# RATE LIMITER
# ============================================================================


class RateLimiter:
    def __init__(self):
        self.requests = defaultdict(list)

    def check(self, ip: str, limit: int = None) -> bool:
        if limit is None:
            limit = config.MAX_REQUESTS_PER_MINUTE

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=60)
        self.requests[ip] = [t for t in self.requests[ip] if t > cutoff]

        if len(self.requests[ip]) >= limit:
            return False

        self.requests[ip].append(now)
        return True

    def cleanup(self):
        """Periodic cleanup of old entries"""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=120)
        self.requests = defaultdict(
            list,
            {k: [t for t in v if t > cutoff] for k, v in self.requests.items() if v},
        )


# ============================================================================
# WEBSOCKET CONNECTION MANAGER
# ============================================================================


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.user_sockets: Dict[str, WebSocket] = {}
        self.heartbeat_tasks: Dict[str, asyncio.Task] = {}
        self.metadata: Dict[str, Dict] = {}
        self.room_state: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, quiz_code: str, user_id: str = None):
        """Connect a WebSocket to a quiz room"""
        try:
            await websocket.accept()
        except Exception as e:
            logger.error(f"Failed to accept WebSocket: {e}")
            return False

        async with self._lock:
            if quiz_code not in self.active_connections:
                self.active_connections[quiz_code] = set()
                self.room_state[quiz_code] = {
                    "participants": {},
                    "answered": set(),
                    "admin_socket": None,
                    "quiz_state": "lobby",
                    "current_question": 0,
                }

            self.active_connections[quiz_code].add(websocket)

            if user_id:
                # Remove old socket if exists
                if user_id in self.user_sockets:
                    old_socket = self.user_sockets[user_id]
                    try:
                        await old_socket.close()
                    except:
                        pass

                self.user_sockets[user_id] = websocket
                self.metadata[user_id] = {
                    "quiz_code": quiz_code,
                    "connected_at": datetime.now(timezone.utc).isoformat(),
                    "is_admin": False,
                }

                # Start heartbeat
                if user_id in self.heartbeat_tasks:
                    self.heartbeat_tasks[user_id].cancel()

                task = asyncio.create_task(self._heartbeat(websocket, user_id))
                self.heartbeat_tasks[user_id] = task

            logger.info(
                f"✓ Connected to {quiz_code}: {len(self.active_connections[quiz_code])} total"
            )
            return True

    def disconnect(self, websocket: WebSocket, quiz_code: str, user_id: str = None):
        """Disconnect a WebSocket from a quiz room"""
        if quiz_code in self.active_connections:
            self.active_connections[quiz_code].discard(websocket)

            if not self.active_connections[quiz_code]:
                del self.active_connections[quiz_code]
                if quiz_code in self.room_state:
                    del self.room_state[quiz_code]

        if user_id:
            if self.user_sockets.get(user_id) == websocket:
                self.user_sockets.pop(user_id, None)

            self.metadata.pop(user_id, None)

            if user_id in self.heartbeat_tasks:
                self.heartbeat_tasks[user_id].cancel()
                del self.heartbeat_tasks[user_id]

            if quiz_code in self.room_state:
                self.room_state[quiz_code]["participants"].pop(user_id, None)
                self.room_state[quiz_code]["answered"].discard(user_id)

                if self.room_state[quiz_code].get("admin_socket") == websocket:
                    self.room_state[quiz_code]["admin_socket"] = None

        logger.info(f"✗ Disconnected from {quiz_code}")

    async def broadcast(self, quiz_code: str, message: dict):
        """Broadcast message to all connections in a room"""
        if quiz_code not in self.active_connections:
            return

        dead_sockets = []
        data = json.dumps(message)

        for conn in list(self.active_connections[quiz_code]):
            try:
                await conn.send_text(data)
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                dead_sockets.append(conn)

        # Clean up dead sockets
        for socket in dead_sockets:
            self.active_connections[quiz_code].discard(socket)

    async def send_personal(self, user_id: str, message: dict):
        """Send message to a specific user"""
        if user_id in self.user_sockets:
            try:
                await self.user_sockets[user_id].send_json(message)
                return True
            except Exception as e:
                logger.error(f"Send personal error: {e}")
                return False
        return False

    async def _heartbeat(self, ws: WebSocket, user_id: str):
        """Maintain connection with periodic pings"""
        try:
            while True:
                await asyncio.sleep(config.WS_HEARTBEAT_SEC)
                try:
                    await ws.send_json({"type": "ping"})
                except:
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Heartbeat error for {user_id}: {e}")

    def get_count(self, quiz_code: str) -> int:
        """Get number of active connections in a room"""
        return len(self.active_connections.get(quiz_code, set()))

    def mark_answered(self, quiz_code: str, user_id: str):
        """Mark a user as having answered the current question"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["answered"].add(user_id)

    def clear_answers(self, quiz_code: str):
        """Clear answered set for next question"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["answered"].clear()

    def get_answer_count(self, quiz_code: str) -> tuple:
        """Get count of answered vs total participants"""
        if quiz_code in self.room_state:
            state = self.room_state[quiz_code]
            answered = len(state["answered"])
            total = len(state["participants"])
            return answered, total
        return 0, 0

    def set_admin(self, quiz_code: str, websocket: WebSocket):
        """Set admin socket for a quiz"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["admin_socket"] = websocket
            logger.info(f"✓ Admin set for {quiz_code}")

    def add_participant(self, quiz_code: str, participant: dict):
        """Add participant to room state"""
        if quiz_code in self.room_state:
            user_id = participant.get("id")
            if user_id:
                self.room_state[quiz_code]["participants"][user_id] = participant
                logger.info(
                    f"✓ Added participant {participant.get('name')} to {quiz_code}"
                )

    def get_participants(self, quiz_code: str) -> list:
        """Get all participants in a room"""
        if quiz_code in self.room_state:
            return list(self.room_state[quiz_code]["participants"].values())
        return []

    def set_quiz_state(self, quiz_code: str, state: str):
        """Set quiz state (lobby, playing, leaderboard, ended)"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["quiz_state"] = state
            logger.info(f"✓ Quiz {quiz_code} state changed to {state}")

    def set_current_question(self, quiz_code: str, index: int):
        """Set current question index"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["current_question"] = index


# ============================================================================
# LIFESPAN MANAGEMENT
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global mongo_client, db, manager, rate_limiter

    logger.info("🚀 Starting Quiz Arena API")

    # Initialize MongoDB
    try:
        mongo_client = AsyncIOMotorClient(
            config.MONGO_URL,
            serverSelectionTimeoutMS=5000,
            maxPoolSize=50,
            minPoolSize=10,
        )
        db = mongo_client[config.DB_NAME]
        await db.command("ping")
        logger.info("✓ MongoDB connected")
    except Exception as e:
        logger.error(f"❌ MongoDB connection failed: {e}")
        raise

    # Create indexes
    try:
        await db.quizzes.create_index("code", unique=True)
        await db.quizzes.create_index("status")
        await db.quizzes.create_index("createdAt")

        await db.participants.create_index([("id", 1), ("quizCode", 1)])
        await db.participants.create_index("quizCode")
        await db.participants.create_index("lastActive")

        await db.questions.create_index([("quizCode", 1), ("index", 1)])
        await db.questions.create_index("quizCode")

        logger.info("✓ Database indexes created")
    except Exception as e:
        logger.error(f"Index creation error: {e}")

    # Initialize managers
    manager = ConnectionManager()
    rate_limiter = RateLimiter()

    # Start background tasks
    cleanup_task = asyncio.create_task(cleanup_inactive_sessions())
    rate_limit_cleanup_task = asyncio.create_task(cleanup_rate_limiter())

    logger.info("✓ Quiz Arena API ready")

    yield

    # Cleanup on shutdown
    logger.info("🛑 Shutting down Quiz Arena API")

    cleanup_task.cancel()
    rate_limit_cleanup_task.cancel()

    if mongo_client:
        mongo_client.close()

    logger.info("✓ Shutdown complete")


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="Quiz Arena API",
    version="2.0.0",
    description="Real-time multiplayer quiz platform",
    lifespan=lifespan,
)

# CORS Middleware - Must be first
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# GZip compression
app.add_middleware(GZipMiddleware, minimum_size=1000)


# Rate limiting middleware
class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for certain paths
        if request.url.path in ["/health", "/", "/docs", "/openapi.json", "/redoc"]:
            return await call_next(request)

        ip = request.client.host
        if not rate_limiter.check(ip):
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded. Please try again later."},
            )
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)

# ============================================================================
# PYDANTIC MODELS
# ============================================================================


class Question(BaseModel):
    question: str
    options: List[str]
    correctAnswer: Union[int, List[int]]
    timeLimit: int = 30
    points: Union[int, str] = "standard"
    type: str = "quiz"
    media: Optional[str] = None


class QuizCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    duration: int
    questions: List[Question]
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    allowedAttempts: int = 1
    shuffleQuestions: bool = False
    showCorrectAnswers: bool = True


class Quiz(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str
    title: str
    description: Optional[str] = ""
    duration: int
    status: str = "active"
    createdAt: str
    questionsCount: int
    participantCount: int = 0
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    allowedAttempts: int = 1
    shuffleQuestions: bool = False
    showCorrectAnswers: bool = True
    lastPlayed: Optional[str] = None


class ParticipantJoin(BaseModel):
    name: str
    quizCode: str
    avatarId: Optional[int] = 1


class Participant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    quizCode: str
    avatarId: int = 1
    joinedAt: str
    score: int = 0
    totalTime: float = 0.0
    answers: List[Dict] = []
    currentQuestion: int = 0
    lastActive: str
    attemptNumber: int = 1
    completedAt: Optional[str] = None


class AnswerSubmit(BaseModel):
    participantId: str
    quizCode: str
    questionIndex: int
    selectedOption: int
    timeTaken: float


class LeaderboardEntry(BaseModel):
    name: str
    score: int
    totalTime: float
    rank: int
    avatarId: int = 1
    participantId: str = ""
    completedAt: Optional[str] = None


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================


def generate_code(length: int = 6) -> str:
    """Generate unique quiz code"""
    chars = string.ascii_uppercase + string.digits
    # Remove confusing characters
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


async def verify_participant(pid: str, code: str) -> Optional[Dict]:
    """Verify participant exists and update last active time"""
    try:
        p = await db.participants.find_one({"id": pid, "quizCode": code}, {"_id": 0})
        if p:
            await db.participants.update_one(
                {"id": pid},
                {"$set": {"lastActive": datetime.now(timezone.utc).isoformat()}},
            )
        return p
    except Exception as e:
        logger.error(f"Verify participant error: {e}")
        return None


async def calc_leaderboard(code: str) -> List[Dict]:
    """Calculate leaderboard for a quiz"""
    try:
        parts = await db.participants.find({"quizCode": code}, {"_id": 0}).to_list(
            config.MAX_PARTICIPANTS
        )

        # Sort by score (descending) then by time (ascending)
        leaderboard = sorted(
            parts, key=lambda x: (-x.get("score", 0), x.get("totalTime", 999999))
        )

        result = []
        for idx, p in enumerate(leaderboard):
            result.append(
                {
                    "name": p.get("name", "Unknown"),
                    "score": p.get("score", 0),
                    "totalTime": round(p.get("totalTime", 0), 2),
                    "rank": idx + 1,
                    "avatarId": p.get("avatarId", 1),
                    "participantId": p.get("id", ""),
                    "completedAt": p.get("completedAt"),
                }
            )

        return result
    except Exception as e:
        logger.error(f"Calculate leaderboard error: {e}")
        return []


async def check_quiz_availability(code: str) -> tuple[bool, str, Optional[Dict]]:
    """Check if quiz is available for joining"""
    try:
        quiz = await db.quizzes.find_one({"code": code}, {"_id": 0})

        if not quiz:
            return False, "Quiz not found", None

        if quiz.get("status") != "active":
            return False, f"Quiz is {quiz.get('status')}", None

        # Check start time
        if quiz.get("startTime"):
            try:
                start = datetime.fromisoformat(quiz["startTime"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) < start:
                    return False, "Quiz has not started yet", None
            except:
                pass

        # Check end time
        if quiz.get("endTime"):
            try:
                end = datetime.fromisoformat(quiz["endTime"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > end:
                    return False, "Quiz has ended", None
            except:
                pass

        # Check participant limit
        count = await db.participants.count_documents({"quizCode": code})
        if count >= config.MAX_PARTICIPANTS:
            return False, "Quiz is full", None

        return True, "Available", quiz
    except Exception as e:
        logger.error(f"Check availability error: {e}")
        return False, "Server error", None


def calc_points(question: Dict, correct: bool, time_taken: float) -> tuple[int, int]:
    """Calculate points for an answer"""
    if not correct:
        return 0, 0

    # Base points
    pts_cfg = question.get("points", "standard")
    if pts_cfg == "standard":
        base = 1000
    elif pts_cfg == "double":
        base = 2000
    elif pts_cfg == "noPoints":
        base = 0
    elif isinstance(pts_cfg, int):
        base = pts_cfg
    else:
        base = 1000

    # Time bonus (up to 500 points based on speed)
    time_limit = question.get("timeLimit", 30)
    time_pct = max(0, min(1, (time_limit - time_taken) / time_limit))
    bonus = int(time_pct * 500)

    return base, bonus


# ============================================================================
# BACKGROUND TASKS
# ============================================================================


async def cleanup_inactive_sessions():
    """Clean up inactive participant sessions"""
    while True:
        try:
            await asyncio.sleep(300)  # Run every 5 minutes

            cutoff = datetime.now(timezone.utc) - timedelta(
                minutes=config.SESSION_TIMEOUT_MIN
            )

            result = await db.participants.delete_many(
                {"lastActive": {"$lt": cutoff.isoformat()}, "completedAt": None}
            )

            if result.deleted_count:
                logger.info(f"🧹 Cleaned {result.deleted_count} inactive participants")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


async def cleanup_rate_limiter():
    """Clean up rate limiter storage"""
    while True:
        try:
            await asyncio.sleep(120)  # Run every 2 minutes
            rate_limiter.cleanup()
        except Exception as e:
            logger.error(f"Rate limiter cleanup error: {e}")


# ============================================================================
# API ROUTES - HEALTH & INFO
# ============================================================================


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "name": "Quiz Arena API",
        "version": "2.0.0",
        "status": "active",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "admin": "/api/admin/*",
            "quiz": "/api/quiz/*",
            "websocket": "/ws/{code}",
        },
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    status = {"status": "healthy", "services": {}}

    # Check MongoDB
    try:
        await db.command("ping")
        status["services"]["mongodb"] = "connected"
    except Exception as e:
        status["services"]["mongodb"] = f"error: {str(e)}"
        status["status"] = "degraded"

    # Check WebSocket manager
    if manager:
        total_connections = sum(len(c) for c in manager.active_connections.values())
        status["services"]["websocket"] = {
            "rooms": len(manager.active_connections),
            "connections": total_connections,
        }

    return status


# ============================================================================
# API ROUTES - ADMIN
# ============================================================================


@app.post("/api/admin/quiz", response_model=Quiz)
async def create_quiz(data: QuizCreate):
    """Create a new quiz"""
    try:
        # Validate questions
        if not data.questions or len(data.questions) > config.MAX_QUIZ_QUESTIONS:
            raise HTTPException(
                400, f"Must have 1-{config.MAX_QUIZ_QUESTIONS} questions"
            )

        # Generate unique code
        code = generate_code()
        for _ in range(10):
            existing = await db.quizzes.find_one({"code": code})
            if not existing:
                break
            code = generate_code()
        else:
            raise HTTPException(500, "Failed to generate unique code")

        # Create quiz document
        quiz_doc = {
            "code": code,
            "title": data.title,
            "description": data.description,
            "duration": data.duration,
            "status": "active",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "questionsCount": len(data.questions),
            "participantCount": 0,
            "startTime": data.startTime,
            "endTime": data.endTime,
            "allowedAttempts": data.allowedAttempts,
            "shuffleQuestions": data.shuffleQuestions,
            "showCorrectAnswers": data.showCorrectAnswers,
            "lastPlayed": None,
        }

        await db.quizzes.insert_one(quiz_doc)

        # Create questions
        questions = []
        for idx, q in enumerate(data.questions):
            questions.append(
                {
                    "quizCode": code,
                    "index": idx,
                    "question": q.question,
                    "options": q.options,
                    "correctAnswer": q.correctAnswer,
                    "timeLimit": q.timeLimit,
                    "points": q.points,
                    "type": q.type,
                    "media": q.media,
                }
            )

        if questions:
            await db.questions.insert_many(questions)

        logger.info(f"✓ Quiz created: {code} - {data.title}")
        return Quiz(**quiz_doc)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create quiz error: {e}")
        raise HTTPException(500, "Failed to create quiz")


@app.get("/api/admin/quizzes", response_model=List[Quiz])
async def get_quizzes(
    status: Optional[str] = None,
    limit: int = Query(100, le=500),
    skip: int = Query(0, ge=0),
):
    """Get all quizzes with optional filtering"""
    try:
        query = {}
        if status:
            query["status"] = status

        quizzes = (
            await db.quizzes.find(query, {"_id": 0})
            .sort("createdAt", -1)
            .skip(skip)
            .limit(limit)
            .to_list(limit)
        )

        return [Quiz(**q) for q in quizzes]
    except Exception as e:
        logger.error(f"Get quizzes error: {e}")
        raise HTTPException(500, "Failed to fetch quizzes")


@app.get("/api/admin/quiz/{code}")
async def get_quiz(code: str):
    """Get quiz details with questions"""
    try:
        quiz = await db.quizzes.find_one({"code": code}, {"_id": 0})
        if not quiz:
            raise HTTPException(404, "Quiz not found")

        questions = (
            await db.questions.find({"quizCode": code}, {"_id": 0})
            .sort("index", 1)
            .to_list(config.MAX_QUIZ_QUESTIONS)
        )

        quiz["questions"] = questions
        return quiz
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get quiz error: {e}")
        raise HTTPException(500, "Failed to fetch quiz")


@app.patch("/api/admin/quiz/{code}/status")
async def update_quiz_status(code: str, status: str = Query(...)):
    """Update quiz status"""
    try:
        if status not in ["active", "inactive", "ended"]:
            raise HTTPException(400, "Invalid status")

        result = await db.quizzes.update_one(
            {"code": code}, {"$set": {"status": status}}
        )

        if result.matched_count == 0:
            raise HTTPException(404, "Quiz not found")

        # Notify via WebSocket
        if manager:
            await manager.broadcast(
                code, {"type": "quiz_status_changed", "status": status}
            )

        logger.info(f"✓ Quiz {code} status changed to {status}")
        return {"success": True, "status": status}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update status error: {e}")
        raise HTTPException(500, "Failed to update status")


@app.delete("/api/admin/quiz/{code}")
async def delete_quiz(code: str):
    """Delete a quiz and all related data"""
    try:
        result = await db.quizzes.delete_one({"code": code})
        if result.deleted_count == 0:
            raise HTTPException(404, "Quiz not found")

        # Delete related data
        await db.questions.delete_many({"quizCode": code})
        await db.participants.delete_many({"quizCode": code})

        logger.info(f"✓ Quiz deleted: {code}")
        return {"success": True, "message": "Quiz deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete error: {e}")
        raise HTTPException(500, "Failed to delete quiz")


@app.get("/api/admin/quiz/{code}/participants")
async def get_quiz_participants(code: str):
    """Get all participants for a quiz"""
    try:
        parts = (
            await db.participants.find({"quizCode": code}, {"_id": 0})
            .sort("score", -1)
            .to_list(config.MAX_PARTICIPANTS)
        )

        return {"participants": parts, "count": len(parts)}
    except Exception as e:
        logger.error(f"Get participants error: {e}")
        raise HTTPException(500, "Failed to fetch participants")


# ============================================================================
# API ROUTES - PARTICIPANT
# ============================================================================


@app.post("/api/join", response_model=Participant)
async def join_quiz(data: ParticipantJoin):
    """Join a quiz as a participant"""
    try:
        # Validate name
        if not data.name or not data.name.strip():
            raise HTTPException(400, "Name is required")

        if len(data.name) > 50:
            raise HTTPException(400, "Name is too long (max 50 characters)")

        # Check quiz availability
        available, msg, quiz = await check_quiz_availability(data.quizCode)
        if not available:
            raise HTTPException(400, msg)

        # Check attempt limit
        existing_count = await db.participants.count_documents(
            {"quizCode": data.quizCode, "name": data.name.strip()}
        )

        if existing_count >= quiz.get("allowedAttempts", 1):
            raise HTTPException(400, "Maximum attempts reached for this name")

        # Create participant
        pid = str(uuid.uuid4())
        pdoc = {
            "id": pid,
            "name": data.name.strip(),
            "quizCode": data.quizCode,
            "avatarId": data.avatarId or 1,
            "joinedAt": datetime.now(timezone.utc).isoformat(),
            "score": 0,
            "totalTime": 0.0,
            "answers": [],
            "currentQuestion": 0,
            "lastActive": datetime.now(timezone.utc).isoformat(),
            "attemptNumber": existing_count + 1,
            "completedAt": None,
        }

        await db.participants.insert_one(pdoc)

        # Update quiz participant count
        await db.quizzes.update_one(
            {"code": data.quizCode},
            {
                "$inc": {"participantCount": 1},
                "$set": {"lastPlayed": datetime.now(timezone.utc).isoformat()},
            },
        )

        logger.info(f"✓ Participant joined: {data.name} -> {data.quizCode}")
        return Participant(**pdoc)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Join error: {e}")
        raise HTTPException(500, "Failed to join quiz")


@app.get("/api/quiz/{code}/questions")
async def get_quiz_questions(code: str, participantId: str):
    """Get questions for a quiz (without answers for participants)"""
    try:
        # Verify participant (except for admin)
        if participantId != "admin":
            p = await verify_participant(participantId, code)
            if not p:
                raise HTTPException(403, "Unauthorized")

        # Get questions
        projection = {"_id": 0}
        if participantId != "admin":
            projection["correctAnswer"] = 0  # Hide answers from participants

        questions = (
            await db.questions.find({"quizCode": code}, projection)
            .sort("index", 1)
            .to_list(config.MAX_QUIZ_QUESTIONS)
        )

        # Shuffle if enabled (only for non-admin)
        if participantId != "admin":
            quiz = await db.quizzes.find_one({"code": code})
            if quiz and quiz.get("shuffleQuestions"):
                random.shuffle(questions)

        return {"questions": questions}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get questions error: {e}")
        raise HTTPException(500, "Failed to fetch questions")


@app.post("/api/submit-answer")
async def submit_answer(ans: AnswerSubmit):
    """Submit an answer to a question"""
    try:
        # Verify participant
        p = await verify_participant(ans.participantId, ans.quizCode)
        if not p:
            raise HTTPException(403, "Unauthorized")

        # Get question
        q = await db.questions.find_one(
            {"quizCode": ans.quizCode, "index": ans.questionIndex}, {"_id": 0}
        )

        if not q:
            raise HTTPException(404, "Question not found")

        # Check if already answered
        for existing_ans in p.get("answers", []):
            if existing_ans.get("questionIndex") == ans.questionIndex:
                raise HTTPException(400, "Question already answered")

        # Validate answer
        is_correct = False
        correct_answer = q.get("correctAnswer")

        if isinstance(correct_answer, list):
            # Multiple correct answers
            is_correct = ans.selectedOption in correct_answer
        else:
            # Single correct answer
            is_correct = correct_answer == ans.selectedOption

        # Calculate points
        base_pts, time_bonus = calc_points(q, is_correct, ans.timeTaken)
        total_pts = base_pts + time_bonus

        # Record answer
        ans_rec = {
            "questionIndex": ans.questionIndex,
            "selectedOption": ans.selectedOption,
            "isCorrect": is_correct,
            "timeTaken": round(ans.timeTaken, 2),
            "points": total_pts,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Update participant
        next_q = ans.questionIndex + 1
        q_count = await db.questions.count_documents({"quizCode": ans.quizCode})
        is_completed = next_q >= q_count

        update_doc = {
            "$inc": {"score": total_pts, "totalTime": ans.timeTaken},
            "$push": {"answers": ans_rec},
            "$set": {
                "currentQuestion": next_q,
                "lastActive": datetime.now(timezone.utc).isoformat(),
            },
        }

        if is_completed:
            update_doc["$set"]["completedAt"] = datetime.now(timezone.utc).isoformat()

        await db.participants.update_one({"id": ans.participantId}, update_doc)

        # Update WebSocket state
        if manager:
            manager.mark_answered(ans.quizCode, ans.participantId)
            answered, total = manager.get_answer_count(ans.quizCode)

            # Broadcast answer count
            await manager.broadcast(
                ans.quizCode,
                {
                    "type": "answer_count",
                    "answeredCount": answered,
                    "totalParticipants": total,
                },
            )

        # Prepare response
        result = {
            "correct": is_correct,
            "points": total_pts,
            "basePoints": base_pts,
            "timeBonus": time_bonus,
            "isCompleted": is_completed,
        }

        # Include correct answer if enabled
        quiz = await db.quizzes.find_one({"code": ans.quizCode})
        if quiz and quiz.get("showCorrectAnswers"):
            result["correctAnswer"] = correct_answer

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Submit answer error: {e}")
        raise HTTPException(500, "Failed to submit answer")


@app.get("/api/leaderboard/{code}", response_model=List[LeaderboardEntry])
async def get_leaderboard(code: str):
    """Get leaderboard for a quiz"""
    try:
        return await calc_leaderboard(code)
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        raise HTTPException(500, "Failed to fetch leaderboard")


@app.get("/api/quiz/{code}/final-results")
async def get_final_results(code: str):
    """Get final results and statistics"""
    try:
        # Get leaderboard
        leaderboard = await calc_leaderboard(code)

        # Get quiz statistics
        total_q = await db.questions.count_documents({"quizCode": code})
        parts = await db.participants.find({"quizCode": code}).to_list(
            config.MAX_PARTICIPANTS
        )

        completed = [p for p in parts if p.get("completedAt")]
        avg_score = sum(p.get("score", 0) for p in parts) / len(parts) if parts else 0
        completion_rate = (len(completed) / len(parts) * 100) if parts else 0

        return {
            "winners": leaderboard[:3] if len(leaderboard) >= 3 else leaderboard,
            "stats": {
                "totalParticipants": len(parts),
                "totalQuestions": total_q,
                "averageScore": int(avg_score),
                "completionRate": int(completion_rate),
            },
        }
    except Exception as e:
        logger.error(f"Final results error: {e}")
        raise HTTPException(500, "Failed to fetch final results")


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================


@app.websocket("/ws/{quiz_code}")
async def websocket_endpoint(websocket: WebSocket, quiz_code: str):
    """WebSocket endpoint for real-time communication"""
    user_id = None
    is_admin = False

    try:
        # Connect WebSocket
        await manager.connect(websocket, quiz_code)

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(data)
                msg_type = msg.get("type")

                # ========== ADMIN JOINED ==========
                if msg_type == "admin_joined":
                    is_admin = True
                    user_id = f"admin_{quiz_code}"
                    manager.set_admin(quiz_code, websocket)
                    logger.info(f"✓ Admin joined: {quiz_code}")

                    # Send current participants from database
                    parts = await db.participants.find(
                        {"quizCode": quiz_code}, {"_id": 0}
                    ).to_list(config.MAX_PARTICIPANTS)

                    # Add to manager state
                    for p in parts:
                        manager.add_participant(quiz_code, p)

                    await websocket.send_json(
                        {"type": "all_participants", "participants": parts}
                    )

                # ========== PARTICIPANT JOINED ==========
                elif msg_type == "participant_joined":
                    participant_id = msg.get("participantId")
                    if participant_id:
                        user_id = participant_id

                        # Fetch participant from DB
                        p = await db.participants.find_one(
                            {"id": participant_id}, {"_id": 0}
                        )

                        if p:
                            # Add to manager
                            manager.add_participant(quiz_code, p)

                            # Broadcast to all clients
                            await manager.broadcast(
                                quiz_code,
                                {
                                    "type": "participant_joined",
                                    "participant": {
                                        "id": p["id"],
                                        "name": p["name"],
                                        "avatarId": p.get("avatarId", 1),
                                    },
                                },
                            )

                            logger.info(f"✓ Participant {p['name']} joined {quiz_code}")

                # ========== QUIZ STARTING ==========
                elif msg_type == "quiz_starting":
                    if is_admin:
                        manager.set_quiz_state(quiz_code, "playing")
                        await manager.broadcast(quiz_code, {"type": "quiz_starting"})
                        logger.info(f"✓ Quiz starting: {quiz_code}")

                # ========== ANSWER SUBMITTED ==========
                elif msg_type == "answer_submitted":
                    participant_id = msg.get("participantId")
                    if participant_id:
                        manager.mark_answered(quiz_code, participant_id)
                        answered, total = manager.get_answer_count(quiz_code)

                        await manager.broadcast(
                            quiz_code,
                            {
                                "type": "answer_count",
                                "answeredCount": answered,
                                "totalParticipants": total,
                            },
                        )

                # ========== SHOW ANSWER (ADMIN) ==========
                elif msg_type == "show_answer":
                    if is_admin:
                        await manager.broadcast(quiz_code, {"type": "show_answer"})
                        logger.info(f"✓ Showing answers: {quiz_code}")

                # ========== SHOW LEADERBOARD (ADMIN) ==========
                elif msg_type == "show_leaderboard":
                    if is_admin:
                        manager.clear_answers(quiz_code)
                        manager.set_quiz_state(quiz_code, "leaderboard")
                        await manager.broadcast(quiz_code, {"type": "show_leaderboard"})
                        logger.info(f"✓ Showing leaderboard: {quiz_code}")

                # ========== NEXT QUESTION (ADMIN) ==========
                elif msg_type == "next_question":
                    if is_admin:
                        manager.clear_answers(quiz_code)
                        manager.set_quiz_state(quiz_code, "playing")
                        await manager.broadcast(quiz_code, {"type": "next_question"})
                        logger.info(f"✓ Next question: {quiz_code}")

                # ========== PING/PONG ==========
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "pong":
                    pass  # Connection alive

                # ========== REQUEST LEADERBOARD ==========
                elif msg_type == "request_leaderboard":
                    lb = await calc_leaderboard(quiz_code)
                    await websocket.send_json(
                        {"type": "leaderboard_update", "leaderboard": lb}
                    )

            except asyncio.TimeoutError:
                # Send ping if no message received
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {quiz_code}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Cleanup
        manager.disconnect(websocket, quiz_code, user_id)

        # Notify remaining clients of disconnect
        count = manager.get_count(quiz_code)
        await manager.broadcast(quiz_code, {"type": "active_count", "count": count})


# ============================================================================
# ERROR HANDLERS
# ============================================================================


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
        log_level="info",
        access_log=True,
    )

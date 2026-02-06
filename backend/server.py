"""
Quiz Arena Backend - Fixed Production Version
Complete WebSocket implementation with proper state management
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
from enum import Enum
import os
import logging
import uuid
import random
import string
import asyncio
import json

# ============================================================================
# LOGGING
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


# ============================================================================
# WEBSOCKET MANAGER - FIXED
# ============================================================================


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.user_sockets: Dict[str, WebSocket] = {}
        self.heartbeat_tasks: Dict[str, asyncio.Task] = {}
        self.metadata: Dict[str, Dict] = {}
        self.room_state: Dict[str, Dict] = {}

    async def connect(self, websocket: WebSocket, quiz_code: str, user_id: str = None):
        await websocket.accept()

        if quiz_code not in self.active_connections:
            self.active_connections[quiz_code] = set()
            self.room_state[quiz_code] = {
                "participants": {},  # user_id -> participant_data
                "answered": set(),
                "admin_socket": None,
                "quiz_state": "lobby",  # lobby, playing, leaderboard, ended
                "current_question": 0,
            }

        self.active_connections[quiz_code].add(websocket)

        if user_id:
            self.user_sockets[user_id] = websocket
            self.metadata[user_id] = {
                "quiz_code": quiz_code,
                "connected_at": datetime.now(timezone.utc).isoformat(),
                "is_admin": False,
            }

            task = asyncio.create_task(self._heartbeat(websocket, user_id))
            self.heartbeat_tasks[user_id] = task

        logger.info(
            f"✓ Connected to {quiz_code}: {len(self.active_connections[quiz_code])} total"
        )
        return True

    def disconnect(self, websocket: WebSocket, quiz_code: str, user_id: str = None):
        if quiz_code in self.active_connections:
            self.active_connections[quiz_code].discard(websocket)
            if not self.active_connections[quiz_code]:
                del self.active_connections[quiz_code]
                if quiz_code in self.room_state:
                    del self.room_state[quiz_code]

        if user_id:
            self.user_sockets.pop(user_id, None)
            self.metadata.pop(user_id, None)
            if user_id in self.heartbeat_tasks:
                self.heartbeat_tasks[user_id].cancel()
                del self.heartbeat_tasks[user_id]

            if quiz_code in self.room_state:
                self.room_state[quiz_code]["participants"].pop(user_id, None)
                self.room_state[quiz_code]["answered"].discard(user_id)

                # Clear admin if disconnecting
                if self.room_state[quiz_code]["admin_socket"] == websocket:
                    self.room_state[quiz_code]["admin_socket"] = None

        logger.info(f"✗ Disconnected from {quiz_code}")

    async def broadcast(self, quiz_code: str, message: dict):
        if quiz_code not in self.active_connections:
            return

        dead = []
        data = json.dumps(message)

        for conn in list(self.active_connections[quiz_code]):
            try:
                await conn.send_text(data)
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                dead.append(conn)

        for d in dead:
            self.active_connections[quiz_code].discard(d)

    async def send_personal(self, user_id: str, message: dict):
        if user_id in self.user_sockets:
            try:
                await self.user_sockets[user_id].send_json(message)
                return True
            except Exception as e:
                logger.error(f"Send personal error: {e}")
        return False

    async def _heartbeat(self, ws: WebSocket, user_id: str):
        try:
            while True:
                await asyncio.sleep(config.WS_HEARTBEAT_SEC)
                await ws.send_json({"type": "ping"})
        except Exception as e:
            logger.error(f"Heartbeat error: {e}")

    def get_count(self, quiz_code: str) -> int:
        return len(self.active_connections.get(quiz_code, set()))

    def mark_answered(self, quiz_code: str, user_id: str):
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["answered"].add(user_id)

    def clear_answers(self, quiz_code: str):
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["answered"].clear()

    def get_answer_count(self, quiz_code: str) -> tuple:
        if quiz_code in self.room_state:
            state = self.room_state[quiz_code]
            answered = len(state["answered"])
            total = len(state["participants"])
            return answered, total
        return 0, 0

    def set_admin(self, quiz_code: str, websocket: WebSocket):
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["admin_socket"] = websocket
            logger.info(f"✓ Admin set for {quiz_code}")

    def add_participant(self, quiz_code: str, participant: dict):
        if quiz_code in self.room_state:
            user_id = participant["id"]
            self.room_state[quiz_code]["participants"][user_id] = participant
            logger.info(f"✓ Added participant {participant['name']} to {quiz_code}")

    def get_participants(self, quiz_code: str) -> list:
        if quiz_code in self.room_state:
            return list(self.room_state[quiz_code]["participants"].values())
        return []

    def set_quiz_state(self, quiz_code: str, state: str):
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["quiz_state"] = state
            logger.info(f"✓ Quiz {quiz_code} state changed to {state}")

    def set_current_question(self, quiz_code: str, index: int):
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["current_question"] = index


# ============================================================================
# LIFESPAN
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client, db, manager, rate_limiter

    logger.info("🚀 Starting Quiz Arena API")

    # MongoDB
    try:
        mongo_client = AsyncIOMotorClient(config.MONGO_URL)
        db = mongo_client[config.DB_NAME]
        await db.command("ping")
        logger.info("✓ MongoDB connected")
    except Exception as e:
        logger.error(f"MongoDB failed: {e}")
        raise

    # Create indexes
    await db.quizzes.create_index("code", unique=True)
    await db.participants.create_index([("id", 1), ("quizCode", 1)])
    await db.questions.create_index([("quizCode", 1), ("index", 1)])
    logger.info("✓ Indexes created")

    # Initialize managers
    manager = ConnectionManager()
    rate_limiter = RateLimiter()

    # Background tasks
    asyncio.create_task(cleanup_inactive())

    logger.info("✓ API ready")

    yield

    logger.info("🛑 Shutting down")
    if mongo_client:
        mongo_client.close()


# ============================================================================
# APP
# ============================================================================

app = FastAPI(title="Quiz Arena API", version="2.0.0", lifespan=lifespan)

# CORS Middleware - Must be first
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


# Rate limit middleware
class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for certain paths
        if request.url.path in ["/health", "/", "/docs", "/openapi.json"]:
            return await call_next(request)

        ip = request.client.host
        if not rate_limiter.check(ip):
            return JSONResponse(
                status_code=429, content={"error": "Rate limit exceeded"}
            )
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)

# ============================================================================
# MODELS
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
# HELPERS
# ============================================================================


def generate_code(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


async def verify_participant(pid: str, code: str) -> Optional[Dict]:
    p = await db.participants.find_one({"id": pid, "quizCode": code}, {"_id": 0})
    if p:
        await db.participants.update_one(
            {"id": pid},
            {"$set": {"lastActive": datetime.now(timezone.utc).isoformat()}},
        )
    return p


async def calc_leaderboard(code: str) -> List[Dict]:
    parts = await db.participants.find({"quizCode": code}, {"_id": 0}).to_list(
        config.MAX_PARTICIPANTS
    )

    leaderboard = sorted(parts, key=lambda x: (-x["score"], x["totalTime"]))

    result = []
    for idx, p in enumerate(leaderboard):
        result.append(
            {
                "name": p["name"],
                "score": p["score"],
                "totalTime": round(p["totalTime"], 2),
                "rank": idx + 1,
                "avatarId": p.get("avatarId", 1),
                "participantId": p["id"],
                "completedAt": p.get("completedAt"),
            }
        )

    return result


async def check_availability(code: str) -> tuple[bool, str, Optional[Dict]]:
    quiz = await db.quizzes.find_one({"code": code}, {"_id": 0})

    if not quiz:
        return False, "Quiz not found", None

    if quiz["status"] != "active":
        return False, f"Quiz is {quiz['status']}", None

    if quiz.get("startTime"):
        try:
            start = datetime.fromisoformat(quiz["startTime"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < start:
                return False, "Quiz not started", None
        except:
            pass

    if quiz.get("endTime"):
        try:
            end = datetime.fromisoformat(quiz["endTime"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > end:
                return False, "Quiz ended", None
        except:
            pass

    count = await db.participants.count_documents({"quizCode": code})
    if count >= config.MAX_PARTICIPANTS:
        return False, "Quiz full", None

    return True, "Available", quiz


def calc_points(question: Dict, correct: bool, time_taken: float) -> tuple[int, int]:
    if not correct:
        return 0, 0

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

    time_limit = question.get("timeLimit", 30)
    time_pct = max(0, min(1, (time_limit - time_taken) / time_limit))
    bonus = int(time_pct * 500)

    return base, bonus


# ============================================================================
# BACKGROUND
# ============================================================================


async def cleanup_inactive():
    while True:
        try:
            await asyncio.sleep(300)
            cutoff = datetime.now(timezone.utc) - timedelta(
                minutes=config.SESSION_TIMEOUT_MIN
            )
            result = await db.participants.delete_many(
                {"lastActive": {"$lt": cutoff.isoformat()}, "completedAt": None}
            )
            if result.deleted_count:
                logger.info(f"Cleaned {result.deleted_count} inactive participants")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


# ============================================================================
# ROUTES - INFO
# ============================================================================


@app.get("/")
async def root():
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
    status = {"status": "healthy", "services": {}}

    try:
        await db.command("ping")
        status["services"]["mongodb"] = "connected"
    except Exception as e:
        status["services"]["mongodb"] = f"error: {str(e)}"
        status["status"] = "degraded"

    if manager:
        total = sum(len(c) for c in manager.active_connections.values())
        status["services"]["websocket"] = {
            "rooms": len(manager.active_connections),
            "connections": total,
        }

    return status


# ============================================================================
# ROUTES - ADMIN
# ============================================================================


@app.post("/api/admin/quiz", response_model=Quiz)
async def create_quiz(data: QuizCreate):
    try:
        code = generate_code()
        for _ in range(10):
            if not await db.quizzes.find_one({"code": code}):
                break
            code = generate_code()

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

        logger.info(f"✓ Quiz created: {code}")
        return Quiz(**quiz_doc)

    except Exception as e:
        logger.error(f"Create quiz error: {e}")
        raise HTTPException(500, "Failed to create quiz")


@app.get("/api/admin/quizzes", response_model=List[Quiz])
async def get_quizzes(status: Optional[str] = None, limit: int = 100, skip: int = 0):
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
async def update_status(code: str, status: str = Query(...)):
    try:
        if status not in ["active", "inactive", "ended"]:
            raise HTTPException(400, "Invalid status")

        result = await db.quizzes.update_one(
            {"code": code}, {"$set": {"status": status}}
        )

        if result.matched_count == 0:
            raise HTTPException(404, "Quiz not found")

        if manager:
            await manager.broadcast(
                code, {"type": "quiz_status_changed", "status": status}
            )

        logger.info(f"✓ Status changed: {code} -> {status}")
        return {"success": True, "status": status}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update status error: {e}")
        raise HTTPException(500, "Failed to update status")


@app.delete("/api/admin/quiz/{code}")
async def delete_quiz(code: str):
    try:
        result = await db.quizzes.delete_one({"code": code})
        if result.deleted_count == 0:
            raise HTTPException(404, "Quiz not found")

        await db.questions.delete_many({"quizCode": code})
        await db.participants.delete_many({"quizCode": code})

        logger.info(f"✓ Quiz deleted: {code}")
        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete error: {e}")
        raise HTTPException(500, "Failed to delete quiz")


@app.get("/api/admin/quiz/{code}/participants")
async def get_participants(code: str):
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
# ROUTES - PARTICIPANT
# ============================================================================


@app.post("/api/join", response_model=Participant)
async def join_quiz(data: ParticipantJoin):
    try:
        available, msg, quiz = await check_availability(data.quizCode)
        if not available:
            raise HTTPException(400, msg)

        existing = await db.participants.count_documents(
            {"quizCode": data.quizCode, "name": data.name}
        )

        if existing >= quiz.get("allowedAttempts", 1):
            raise HTTPException(400, "Max attempts reached")

        pid = str(uuid.uuid4())
        pdoc = {
            "id": pid,
            "name": data.name,
            "quizCode": data.quizCode,
            "avatarId": data.avatarId or 1,
            "joinedAt": datetime.now(timezone.utc).isoformat(),
            "score": 0,
            "totalTime": 0.0,
            "answers": [],
            "currentQuestion": 0,
            "lastActive": datetime.now(timezone.utc).isoformat(),
            "attemptNumber": existing + 1,
            "completedAt": None,
        }

        await db.participants.insert_one(pdoc)

        await db.quizzes.update_one(
            {"code": data.quizCode},
            {
                "$inc": {"participantCount": 1},
                "$set": {"lastPlayed": datetime.now(timezone.utc).isoformat()},
            },
        )

        logger.info(f"✓ Joined: {data.name} -> {data.quizCode}")
        return Participant(**pdoc)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Join error: {e}")
        raise HTTPException(500, "Failed to join")


@app.get("/api/quiz/{code}/questions")
async def get_questions(code: str, participantId: str):
    try:
        if participantId != "admin":
            p = await verify_participant(participantId, code)
            if not p:
                raise HTTPException(403, "Unauthorized")

        questions = (
            await db.questions.find({"quizCode": code}, {"_id": 0, "correctAnswer": 0})
            .sort("index", 1)
            .to_list(config.MAX_QUIZ_QUESTIONS)
        )

        quiz = await db.quizzes.find_one({"code": code})
        if quiz and quiz.get("shuffleQuestions") and participantId != "admin":
            random.shuffle(questions)

        return {"questions": questions}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get questions error: {e}")
        raise HTTPException(500, "Failed to fetch questions")


@app.post("/api/submit-answer")
async def submit_answer(ans: AnswerSubmit):
    try:
        p = await verify_participant(ans.participantId, ans.quizCode)
        if not p:
            raise HTTPException(403, "Unauthorized")

        q = await db.questions.find_one(
            {"quizCode": ans.quizCode, "index": ans.questionIndex}, {"_id": 0}
        )

        if not q:
            raise HTTPException(404, "Question not found")

        # Check duplicate
        for a in p.get("answers", []):
            if a["questionIndex"] == ans.questionIndex:
                raise HTTPException(400, "Already answered")

        is_correct = q["correctAnswer"] == ans.selectedOption
        base_pts, time_bonus = calc_points(q, is_correct, ans.timeTaken)
        total_pts = base_pts + time_bonus

        ans_rec = {
            "questionIndex": ans.questionIndex,
            "selectedOption": ans.selectedOption,
            "isCorrect": is_correct,
            "timeTaken": ans.timeTaken,
            "points": total_pts,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
        }

        next_q = ans.questionIndex + 1
        q_count = await db.questions.count_documents({"quizCode": ans.quizCode})
        is_done = next_q >= q_count

        update = {
            "$inc": {"score": total_pts, "totalTime": ans.timeTaken},
            "$push": {"answers": ans_rec},
            "$set": {
                "currentQuestion": next_q,
                "lastActive": datetime.now(timezone.utc).isoformat(),
            },
        }

        if is_done:
            update["$set"]["completedAt"] = datetime.now(timezone.utc).isoformat()

        await db.participants.update_one({"id": ans.participantId}, update)

        # Mark as answered in WebSocket manager
        if manager:
            manager.mark_answered(ans.quizCode, ans.participantId)
            answered, total = manager.get_answer_count(ans.quizCode)

            # Broadcast answer count to admin
            await manager.broadcast(
                ans.quizCode,
                {
                    "type": "answer_count",
                    "answeredCount": answered,
                    "totalParticipants": total,
                },
            )

        quiz = await db.quizzes.find_one({"code": ans.quizCode})

        result = {
            "correct": is_correct,
            "points": total_pts,
            "basePoints": base_pts,
            "timeBonus": time_bonus,
            "isCompleted": is_done,
        }

        if quiz and quiz.get("showCorrectAnswers"):
            result["correctAnswer"] = q["correctAnswer"]

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Submit answer error: {e}")
        raise HTTPException(500, "Failed to submit answer")


@app.get("/api/leaderboard/{code}", response_model=List[LeaderboardEntry])
async def get_leaderboard(code: str):
    try:
        return await calc_leaderboard(code)
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        raise HTTPException(500, "Failed to fetch leaderboard")


@app.get("/api/quiz/{code}/final-results")
async def get_final_results(code: str):
    try:
        leaderboard = await calc_leaderboard(code)

        # Get quiz stats
        total_q = await db.questions.count_documents({"quizCode": code})
        parts = await db.participants.find({"quizCode": code}).to_list(
            config.MAX_PARTICIPANTS
        )

        completed = [p for p in parts if p.get("completedAt")]
        avg_score = sum(p["score"] for p in parts) / len(parts) if parts else 0
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
# WEBSOCKET - COMPLETE REWRITE WITH PROPER FLOW
# ============================================================================


@app.websocket("/ws/{quiz_code}")
async def websocket_endpoint(websocket: WebSocket, quiz_code: str):
    user_id = None
    is_admin = False

    try:
        await manager.connect(websocket, quiz_code)

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(data)
                msg_type = msg.get("type")

                # ========== ADMIN JOINED ==========
                if msg_type == "admin_joined":
                    is_admin = True
                    user_id = f"admin_{quiz_code}"
                    manager.set_admin(quiz_code, websocket)
                    logger.info(f"✓ Admin joined room: {quiz_code}")

                    # Send all current participants from DB
                    parts = await db.participants.find(
                        {"quizCode": quiz_code}, {"_id": 0}
                    ).to_list(config.MAX_PARTICIPANTS)

                    # Also add them to manager state
                    for p in parts:
                        manager.add_participant(quiz_code, p)

                    await websocket.send_json(
                        {"type": "all_participants", "participants": parts}
                    )

                # ========== PARTICIPANT JOINED ==========
                elif msg_type == "participant_joined":
                    user_id = msg.get("participantId")
                    if user_id:
                        # Store socket
                        manager.user_sockets[user_id] = websocket

                        # Fetch participant from DB
                        p = await db.participants.find_one({"id": user_id}, {"_id": 0})

                        if p:
                            # Add to manager state
                            manager.add_participant(quiz_code, p)

                            # Broadcast to ALL clients (admin + users)
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

                            logger.info(f"✓ Participant {p['name']} broadcast to room")

                # ========== QUIZ STARTING ==========
                elif msg_type == "quiz_starting":
                    manager.set_quiz_state(quiz_code, "playing")
                    await manager.broadcast(quiz_code, {"type": "quiz_starting"})
                    logger.info(f"✓ Quiz starting: {quiz_code}")

                # ========== ANSWER SUBMITTED ==========
                elif msg_type == "answer_submitted":
                    participant_id = msg.get("participantId")
                    if participant_id:
                        manager.mark_answered(quiz_code, participant_id)
                        answered, total = manager.get_answer_count(quiz_code)

                        # Broadcast count to ALL
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
                    await manager.broadcast(quiz_code, {"type": "show_answer"})
                    logger.info(f"✓ Showing answers for {quiz_code}")

                # ========== SHOW LEADERBOARD (ADMIN) ==========
                elif msg_type == "show_leaderboard":
                    manager.clear_answers(quiz_code)
                    manager.set_quiz_state(quiz_code, "leaderboard")
                    await manager.broadcast(quiz_code, {"type": "show_leaderboard"})
                    logger.info(f"✓ Showing leaderboard for {quiz_code}")

                # ========== NEXT QUESTION (ADMIN) ==========
                elif msg_type == "next_question":
                    manager.clear_answers(quiz_code)
                    await manager.broadcast(quiz_code, {"type": "next_question"})
                    logger.info(f"✓ Next question for {quiz_code}")

                # ========== PING/PONG ==========
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "pong":
                    pass

                # ========== REQUEST LEADERBOARD ==========
                elif msg_type == "request_leaderboard":
                    lb = await calc_leaderboard(quiz_code)
                    await websocket.send_json(
                        {"type": "leaderboard_update", "leaderboard": lb}
                    )

            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        logger.info(f"WS disconnected: {quiz_code}")
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        manager.disconnect(websocket, quiz_code, user_id)

        # Notify remaining clients
        count = manager.get_count(quiz_code)
        await manager.broadcast(quiz_code, {"type": "active_count", "count": count})


# ============================================================================
# ERROR HANDLERS
# ============================================================================


@app.exception_handler(HTTPException)
async def http_handler(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def general_handler(request, exc):
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
    )

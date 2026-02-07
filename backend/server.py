"""
Quiz Arena Backend - FIXED with Explicit State Machine
All bugs fixed: proper state transitions, question index sync, answer submission
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Set, Union
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import os
import logging
import uuid
import random
import string
import asyncio
import json

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Configuration
class Config:
    MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    DB_NAME = os.getenv("DB_NAME", "quiz_arena")
    MAX_PARTICIPANTS = 1000
    WS_HEARTBEAT_SEC = 25
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "https://*",
    ]


config = Config()
mongo_client = None
db = None
manager = None


# STATE MACHINE - EXPLICIT STATES
class QuizState:
    LOBBY = "lobby"
    QUESTION = "question"
    LEADERBOARD = "leaderboard"
    FINAL_LEADERBOARD = "final_leaderboard"
    PODIUM = "podium"
    ENDED = "ended"


# WEBSOCKET CONNECTION MANAGER WITH STATE MACHINE
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.user_sockets: Dict[str, WebSocket] = {}
        self.heartbeat_tasks: Dict[str, asyncio.Task] = {}
        self.room_state: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, quiz_code: str, user_id: str = None):
        try:
            await websocket.accept()
        except Exception as e:
            logger.error(f"Failed to accept WebSocket: {e}")
            return False

        async with self._lock:
            if quiz_code not in self.active_connections:
                self.active_connections[quiz_code] = set()
                self.room_state[quiz_code] = {
                    "quiz_state": QuizState.LOBBY,
                    "current_question": 0,
                    "total_questions": 0,
                    "participants": {},
                    "answered": set(),
                    "admin_socket": None,
                }

            self.active_connections[quiz_code].add(websocket)

            if user_id:
                if user_id in self.user_sockets:
                    old_socket = self.user_sockets[user_id]
                    try:
                        await old_socket.close()
                    except:
                        pass

                self.user_sockets[user_id] = websocket

                if user_id in self.heartbeat_tasks:
                    self.heartbeat_tasks[user_id].cancel()

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
            if self.user_sockets.get(user_id) == websocket:
                self.user_sockets.pop(user_id, None)

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

        for socket in dead_sockets:
            self.active_connections[quiz_code].discard(socket)

    async def _heartbeat(self, ws: WebSocket, user_id: str):
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

    def set_state(self, quiz_code: str, state: str):
        """Set quiz state - ADMIN ONLY"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["quiz_state"] = state
            logger.info(f"✓ Quiz {quiz_code} state: {state}")

    def get_state(self, quiz_code: str) -> str:
        if quiz_code in self.room_state:
            return self.room_state[quiz_code]["quiz_state"]
        return QuizState.LOBBY

    def set_question(self, quiz_code: str, index: int):
        """Set current question index"""
        if quiz_code in self.room_state:
            self.room_state[quiz_code]["current_question"] = index
            self.room_state[quiz_code]["answered"].clear()
            logger.info(f"✓ Quiz {quiz_code} question: {index}")

    def get_question(self, quiz_code: str) -> int:
        if quiz_code in self.room_state:
            return self.room_state[quiz_code]["current_question"]
        return 0

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
            user_id = participant.get("id")
            if user_id:
                self.room_state[quiz_code]["participants"][user_id] = participant

    def get_participants(self, quiz_code: str) -> list:
        if quiz_code in self.room_state:
            return list(self.room_state[quiz_code]["participants"].values())
        return []


# LIFESPAN
@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client, db, manager

    logger.info("🚀 Starting Quiz Arena API")

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

    try:
        await db.quizzes.create_index("code", unique=True)
        await db.quizzes.create_index("status")
        await db.participants.create_index([("id", 1), ("quizCode", 1)])
        await db.participants.create_index("quizCode")
        await db.questions.create_index([("quizCode", 1), ("index", 1)])
        logger.info("✓ Database indexes created")
    except Exception as e:
        logger.error(f"Index creation error: {e}")

    manager = ConnectionManager()
    logger.info("✓ Quiz Arena API ready")

    yield

    logger.info("🛑 Shutting down Quiz Arena API")
    if mongo_client:
        mongo_client.close()
    logger.info("✓ Shutdown complete")


# FASTAPI APPLICATION
app = FastAPI(
    title="Quiz Arena API",
    version="2.0.0",
    description="Real-time multiplayer quiz platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


# PYDANTIC MODELS
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
    avatarSeed: Optional[str] = None


class Participant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    quizCode: str
    avatarSeed: str
    joinedAt: str
    score: int = 0
    totalTime: float = 0.0
    answers: List[Dict] = []
    currentQuestion: int = 0
    lastActive: str
    attemptNumber: int = 1
    completedAt: Optional[str] = None


class AvatarRequest(BaseModel):
    quizCode: str
    participantId: str


class AvatarResponse(BaseModel):
    seed: str
    url: str


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
    avatarSeed: str = ""
    participantId: str = ""
    completedAt: Optional[str] = None


# HELPER FUNCTIONS
def generate_code(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


async def verify_participant(pid: str, code: str) -> Optional[Dict]:
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


async def is_avatar_unique(
    quiz_code: str, seed: str, exclude_participant: str = None
) -> bool:
    try:
        query = {"quizCode": quiz_code, "avatarSeed": seed}
        if exclude_participant:
            query["id"] = {"$ne": exclude_participant}
        existing = await db.participants.find_one(query)
        return existing is None
    except Exception as e:
        logger.error(f"Avatar uniqueness check error: {e}")
        return True


async def generate_unique_avatar(
    quiz_code: str, exclude_participant: str = None
) -> str:
    max_attempts = 50
    for _ in range(max_attempts):
        seed = f"{quiz_code}-{uuid.uuid4().hex[:8]}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        if await is_avatar_unique(quiz_code, seed, exclude_participant):
            return seed
    return f"{quiz_code}-fallback-{uuid.uuid4().hex}"


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


async def calc_leaderboard(code: str) -> List[Dict]:
    try:
        parts = await db.participants.find({"quizCode": code}, {"_id": 0}).to_list(
            config.MAX_PARTICIPANTS
        )
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
                    "avatarSeed": p.get("avatarSeed", ""),
                    "participantId": p.get("id", ""),
                    "completedAt": p.get("completedAt"),
                }
            )

        return result
    except Exception as e:
        logger.error(f"Calculate leaderboard error: {e}")
        return []


# API ROUTES
@app.get("/")
async def root():
    return {
        "name": "Quiz Arena API",
        "version": "2.0.0",
        "status": "active",
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
    return status


@app.post("/api/admin/quiz", response_model=Quiz)
async def create_quiz(data: QuizCreate):
    try:
        if not data.questions or len(data.questions) > 100:
            raise HTTPException(400, "Must have 1-100 questions")

        code = generate_code()
        for _ in range(10):
            existing = await db.quizzes.find_one({"code": code})
            if not existing:
                break
            code = generate_code()
        else:
            raise HTTPException(500, "Failed to generate unique code")

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
            .to_list(100)
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

        logger.info(f"✓ Quiz {code} status changed to {status}")
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
        return {"success": True, "message": "Quiz deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete error: {e}")
        raise HTTPException(500, "Failed to delete quiz")


@app.get("/api/admin/quiz/{code}/participants")
async def get_quiz_participants(code: str):
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


@app.post("/api/avatar/unique", response_model=AvatarResponse)
async def get_unique_avatar(data: AvatarRequest):
    try:
        seed = await generate_unique_avatar(data.quizCode, data.participantId)
        dicebear_url = f"https://api.dicebear.com/7.x/fun-emoji/svg?seed={seed}"
        return AvatarResponse(seed=seed, url=dicebear_url)
    except Exception as e:
        logger.error(f"Generate unique avatar error: {e}")
        raise HTTPException(500, "Failed to generate unique avatar")


@app.post("/api/avatar/reroll")
async def reroll_avatar(data: AvatarRequest):
    try:
        participant = await verify_participant(data.participantId, data.quizCode)
        if not participant:
            raise HTTPException(403, "Unauthorized")

        if manager and manager.get_state(data.quizCode) != QuizState.LOBBY:
            raise HTTPException(400, "Cannot change avatar after quiz starts")

        new_seed = await generate_unique_avatar(data.quizCode, data.participantId)

        await db.participants.update_one(
            {"id": data.participantId}, {"$set": {"avatarSeed": new_seed}}
        )

        if manager:
            await manager.broadcast(
                data.quizCode,
                {
                    "type": "avatar_updated",
                    "participantId": data.participantId,
                    "avatarSeed": new_seed,
                },
            )

        dicebear_url = f"https://api.dicebear.com/7.x/fun-emoji/svg?seed={new_seed}"

        logger.info(f"✓ Avatar rerolled for {data.participantId} in {data.quizCode}")
        return AvatarResponse(seed=new_seed, url=dicebear_url)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reroll avatar error: {e}")
        raise HTTPException(500, "Failed to reroll avatar")


@app.post("/api/join", response_model=Participant)
async def join_quiz(data: ParticipantJoin):
    try:
        if not data.name or not data.name.strip():
            raise HTTPException(400, "Name is required")

        if len(data.name) > 50:
            raise HTTPException(400, "Name is too long (max 50 characters)")

        quiz = await db.quizzes.find_one({"code": data.quizCode})
        if not quiz:
            raise HTTPException(404, "Quiz not found")

        if quiz.get("status") != "active":
            raise HTTPException(400, f"Quiz is {quiz.get('status')}")

        existing_count = await db.participants.count_documents(
            {"quizCode": data.quizCode, "name": data.name.strip()}
        )

        if existing_count >= quiz.get("allowedAttempts", 1):
            raise HTTPException(400, "Maximum attempts reached for this name")

        avatar_seed = data.avatarSeed
        if not avatar_seed:
            avatar_seed = await generate_unique_avatar(data.quizCode)
        else:
            if not await is_avatar_unique(data.quizCode, avatar_seed):
                avatar_seed = await generate_unique_avatar(data.quizCode)

        pid = str(uuid.uuid4())
        pdoc = {
            "id": pid,
            "name": data.name.strip(),
            "quizCode": data.quizCode,
            "avatarSeed": avatar_seed,
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
    try:
        if participantId != "admin":
            p = await verify_participant(participantId, code)
            if not p:
                raise HTTPException(403, "Unauthorized")

        projection = {"_id": 0}
        if participantId != "admin":
            projection["correctAnswer"] = 0

        questions = (
            await db.questions.find({"quizCode": code}, projection)
            .sort("index", 1)
            .to_list(100)
        )

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
    try:
        # Verify participant
        p = await verify_participant(ans.participantId, ans.quizCode)
        if not p:
            raise HTTPException(403, "Unauthorized")

        # Verify we're in QUESTION state
        if manager:
            current_state = manager.get_state(ans.quizCode)
            if current_state != QuizState.QUESTION:
                raise HTTPException(
                    400, f"Cannot submit answer in {current_state} state"
                )

            # Verify question index matches backend
            backend_question = manager.get_question(ans.quizCode)
            if ans.questionIndex != backend_question:
                raise HTTPException(
                    400,
                    f"Question index mismatch: expected {backend_question}, got {ans.questionIndex}",
                )

        # Get question
        q = await db.questions.find_one(
            {"quizCode": ans.quizCode, "index": ans.questionIndex}, {"_id": 0}
        )

        if not q:
            raise HTTPException(404, "Question not found")

        # Check if already answered THIS question
        for existing_ans in p.get("answers", []):
            if existing_ans.get("questionIndex") == ans.questionIndex:
                raise HTTPException(400, "Question already answered")

        # Calculate correctness
        is_correct = False
        correct_answer = q.get("correctAnswer")

        if isinstance(correct_answer, list):
            is_correct = ans.selectedOption in correct_answer
        else:
            is_correct = correct_answer == ans.selectedOption

        # Calculate points
        base_pts, time_bonus = calc_points(q, is_correct, ans.timeTaken)
        total_pts = base_pts + time_bonus

        # Create answer record
        ans_rec = {
            "questionIndex": ans.questionIndex,
            "selectedOption": ans.selectedOption,
            "isCorrect": is_correct,
            "timeTaken": round(ans.timeTaken, 2),
            "points": total_pts,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Update participant - DO NOT increment currentQuestion here
        # Backend controls question flow via WebSocket
        q_count = await db.questions.count_documents({"quizCode": ans.quizCode})
        is_completed = ans.questionIndex + 1 >= q_count

        update_doc = {
            "$inc": {"score": total_pts, "totalTime": ans.timeTaken},
            "$push": {"answers": ans_rec},
            "$set": {
                "lastActive": datetime.now(timezone.utc).isoformat(),
            },
        }

        if is_completed:
            update_doc["$set"]["completedAt"] = datetime.now(timezone.utc).isoformat()

        await db.participants.update_one({"id": ans.participantId}, update_doc)

        # Mark answered in connection manager
        if manager:
            manager.mark_answered(ans.quizCode, ans.participantId)
            answered, total = manager.get_answer_count(ans.quizCode)

            await manager.broadcast(
                ans.quizCode,
                {
                    "type": "answer_count",
                    "answeredCount": answered,
                    "totalParticipants": total,
                },
            )

        # Prepare result
        result = {
            "correct": is_correct,
            "points": total_pts,
            "basePoints": base_pts,
            "timeBonus": time_bonus,
            "isCompleted": is_completed,
        }

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
    try:
        return await calc_leaderboard(code)
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        raise HTTPException(500, "Failed to fetch leaderboard")


@app.get("/api/quiz/{code}/final-results")
async def get_final_results(code: str):
    try:
        leaderboard = await calc_leaderboard(code)
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


# WEBSOCKET ENDPOINT WITH STATE MACHINE
@app.websocket("/ws/{quiz_code}")
async def websocket_endpoint(websocket: WebSocket, quiz_code: str):
    user_id = None
    is_admin = False

    try:
        await manager.connect(websocket, quiz_code)

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(data)
                msg_type = msg.get("type")

                if msg_type == "admin_joined":
                    is_admin = True
                    user_id = f"admin_{quiz_code}"
                    manager.set_admin(quiz_code, websocket)

                    # Get question count
                    q_count = await db.questions.count_documents(
                        {"quizCode": quiz_code}
                    )
                    manager.room_state[quiz_code]["total_questions"] = q_count

                    logger.info(f"✓ Admin joined: {quiz_code}")

                    # Send current participants with avatars
                    parts = await db.participants.find(
                        {"quizCode": quiz_code}, {"_id": 0}
                    ).to_list(config.MAX_PARTICIPANTS)

                    for p in parts:
                        manager.add_participant(quiz_code, p)

                    await websocket.send_json(
                        {
                            "type": "all_participants",
                            "participants": parts,
                            "quiz_state": manager.get_state(quiz_code),
                            "current_question": manager.get_question(quiz_code),
                            "total_questions": q_count,
                        }
                    )

                elif msg_type == "participant_joined":
                    participant_id = msg.get("participantId")
                    if participant_id:
                        user_id = participant_id
                        p = await db.participants.find_one(
                            {"id": participant_id}, {"_id": 0}
                        )

                        if p:
                            manager.add_participant(quiz_code, p)

                            await manager.broadcast(
                                quiz_code,
                                {
                                    "type": "participant_joined",
                                    "participant": {
                                        "id": p["id"],
                                        "name": p["name"],
                                        "avatarSeed": p.get("avatarSeed", ""),
                                    },
                                },
                            )

                            logger.info(f"✓ Participant {p['name']} joined {quiz_code}")

                elif msg_type == "quiz_starting":
                    if is_admin:
                        manager.set_state(quiz_code, QuizState.QUESTION)
                        manager.set_question(quiz_code, 0)

                        await manager.broadcast(
                            quiz_code,
                            {
                                "type": "quiz_starting",
                                "quiz_state": QuizState.QUESTION,
                                "current_question": 0,
                            },
                        )
                        logger.info(f"✓ Quiz starting: {quiz_code}")

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

                elif msg_type == "show_answer":
                    if is_admin:
                        await manager.broadcast(quiz_code, {"type": "show_answer"})
                        logger.info(f"✓ Showing answers: {quiz_code}")

                elif msg_type == "show_leaderboard":
                    if is_admin:
                        current_q = manager.get_question(quiz_code)
                        total_q = manager.room_state[quiz_code]["total_questions"]

                        if current_q >= total_q - 1:
                            manager.set_state(quiz_code, QuizState.FINAL_LEADERBOARD)
                        else:
                            manager.set_state(quiz_code, QuizState.LEADERBOARD)

                        manager.clear_answers(quiz_code)

                        await manager.broadcast(
                            quiz_code,
                            {
                                "type": "show_leaderboard",
                                "quiz_state": manager.get_state(quiz_code),
                                "current_question": current_q,
                                "total_questions": total_q,
                            },
                        )
                        logger.info(f"✓ Showing leaderboard: {quiz_code}")

                elif msg_type == "next_question":
                    if is_admin:
                        current_q = manager.get_question(quiz_code)
                        total_q = manager.room_state[quiz_code]["total_questions"]
                        next_q = current_q + 1

                        if next_q < total_q:
                            manager.set_question(quiz_code, next_q)
                            manager.set_state(quiz_code, QuizState.QUESTION)
                            manager.clear_answers(quiz_code)

                            await manager.broadcast(
                                quiz_code,
                                {
                                    "type": "next_question",
                                    "quiz_state": QuizState.QUESTION,
                                    "current_question": next_q,
                                    "total_questions": total_q,
                                },
                            )
                            logger.info(f"✓ Next question {next_q}: {quiz_code}")
                        else:
                            manager.set_state(quiz_code, QuizState.PODIUM)
                            await manager.broadcast(
                                quiz_code,
                                {
                                    "type": "show_podium",
                                    "quiz_state": QuizState.PODIUM,
                                },
                            )
                            logger.info(f"✓ Showing podium: {quiz_code}")

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "pong":
                    pass

            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {quiz_code}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        manager.disconnect(websocket, quiz_code, user_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
        log_level="info",
    )

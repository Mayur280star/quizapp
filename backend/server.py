from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import socketio
import random
import string

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Socket.IO setup
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False
)

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, quiz_code: str):
        await websocket.accept()
        if quiz_code not in self.active_connections:
            self.active_connections[quiz_code] = []
        self.active_connections[quiz_code].append(websocket)

    def disconnect(self, websocket: WebSocket, quiz_code: str):
        if quiz_code in self.active_connections:
            self.active_connections[quiz_code].remove(websocket)

    async def broadcast(self, quiz_code: str, message: dict):
        if quiz_code in self.active_connections:
            dead_connections = []
            for connection in self.active_connections[quiz_code]:
                try:
                    await connection.send_json(message)
                except:
                    dead_connections.append(connection)
            for dead in dead_connections:
                self.active_connections[quiz_code].remove(dead)

manager = ConnectionManager()

# Models
class Question(BaseModel):
    question: str
    options: List[str]
    correctAnswer: int
    timeLimit: int

class QuizCreate(BaseModel):
    title: str
    duration: int
    questions: List[Question]

class Quiz(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str
    title: str
    duration: int
    status: str = "active"
    createdAt: str
    questionsCount: int

class ParticipantJoin(BaseModel):
    name: str
    quizCode: str

class Participant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    quizCode: str
    joinedAt: str
    score: int = 0
    totalTime: float = 0.0

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

# Helper functions
def generate_quiz_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

# Routes
@api_router.get("/")
async def root():
    return {"message": "Quiz Arena API"}

@api_router.post("/admin/quiz", response_model=Quiz)
async def create_quiz(quiz_data: QuizCreate):
    code = generate_quiz_code()
    
    # Check if code already exists
    existing = await db.quizzes.find_one({"code": code}, {"_id": 0})
    while existing:
        code = generate_quiz_code()
        existing = await db.quizzes.find_one({"code": code}, {"_id": 0})
    
    quiz_doc = {
        "code": code,
        "title": quiz_data.title,
        "duration": quiz_data.duration,
        "status": "active",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "questionsCount": len(quiz_data.questions)
    }
    
    await db.quizzes.insert_one(quiz_doc)
    
    # Store questions separately
    for idx, q in enumerate(quiz_data.questions):
        question_doc = {
            "quizCode": code,
            "index": idx,
            "question": q.question,
            "options": q.options,
            "correctAnswer": q.correctAnswer,
            "timeLimit": q.timeLimit
        }
        await db.questions.insert_one(question_doc)
    
    return Quiz(**quiz_doc)

@api_router.get("/admin/quizzes", response_model=List[Quiz])
async def get_all_quizzes():
    quizzes = await db.quizzes.find({}, {"_id": 0}).to_list(100)
    return [Quiz(**q) for q in quizzes]

@api_router.patch("/admin/quiz/{code}/status")
async def update_quiz_status(code: str, status: str):
    result = await db.quizzes.update_one(
        {"code": code},
        {"$set": {"status": status}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return {"success": True}

@api_router.post("/join", response_model=Participant)
async def join_quiz(join_data: ParticipantJoin):
    # Check if quiz exists and is active
    quiz = await db.quizzes.find_one(
        {"code": join_data.quizCode, "status": "active"},
        {"_id": 0}
    )
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found or inactive")
    
    participant_id = str(uuid.uuid4())
    participant_doc = {
        "id": participant_id,
        "name": join_data.name,
        "quizCode": join_data.quizCode,
        "joinedAt": datetime.now(timezone.utc).isoformat(),
        "score": 0,
        "totalTime": 0.0
    }
    
    await db.participants.insert_one(participant_doc)
    
    # Broadcast new participant to leaderboard
    await manager.broadcast(join_data.quizCode, {
        "type": "participant_joined",
        "participant": participant_doc
    })
    
    return Participant(**participant_doc)

@api_router.get("/quiz/{code}/questions")
async def get_quiz_questions(code: str, participantId: str):
    # Verify participant
    participant = await db.participants.find_one(
        {"id": participantId, "quizCode": code},
        {"_id": 0}
    )
    if not participant:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    # Get questions without correct answers
    questions = await db.questions.find(
        {"quizCode": code},
        {"_id": 0, "correctAnswer": 0}
    ).sort("index", 1).to_list(100)
    
    return {"questions": questions}

@api_router.post("/submit-answer")
async def submit_answer(answer: AnswerSubmit):
    # Get correct answer
    question = await db.questions.find_one(
        {"quizCode": answer.quizCode, "index": answer.questionIndex},
        {"_id": 0}
    )
    
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    is_correct = question["correctAnswer"] == answer.selectedOption
    points = 10 if is_correct else 0
    
    # Update participant score and time
    await db.participants.update_one(
        {"id": answer.participantId},
        {
            "$inc": {"score": points, "totalTime": answer.timeTaken}
        }
    )
    
    # Get updated leaderboard
    participants = await db.participants.find(
        {"quizCode": answer.quizCode},
        {"_id": 0}
    ).to_list(1000)
    
    # Sort by score (desc) then by time (asc)
    leaderboard = sorted(
        participants,
        key=lambda x: (-x["score"], x["totalTime"])
    )
    
    # Add ranks
    ranked_leaderboard = [
        {"name": p["name"], "score": p["score"], "totalTime": p["totalTime"], "rank": idx + 1}
        for idx, p in enumerate(leaderboard)
    ]
    
    # Broadcast updated leaderboard
    await manager.broadcast(answer.quizCode, {
        "type": "leaderboard_update",
        "leaderboard": ranked_leaderboard
    })
    
    return {
        "correct": is_correct,
        "points": points,
        "correctAnswer": question["correctAnswer"]
    }

@api_router.get("/leaderboard/{code}", response_model=List[LeaderboardEntry])
async def get_leaderboard(code: str):
    participants = await db.participants.find(
        {"quizCode": code},
        {"_id": 0}
    ).to_list(1000)
    
    leaderboard = sorted(
        participants,
        key=lambda x: (-x["score"], x["totalTime"])
    )
    
    return [
        LeaderboardEntry(
            name=p["name"],
            score=p["score"],
            totalTime=p["totalTime"],
            rank=idx + 1
        )
        for idx, p in enumerate(leaderboard)
    ]

@api_router.get("/admin/quiz/{code}/participants")
async def get_quiz_participants(code: str):
    participants = await db.participants.find(
        {"quizCode": code},
        {"_id": 0}
    ).to_list(1000)
    return {"participants": participants, "count": len(participants)}

# WebSocket endpoint
@app.websocket("/ws/{quiz_code}")
async def websocket_endpoint(websocket: WebSocket, quiz_code: str):
    await manager.connect(websocket, quiz_code)
    try:
        while True:
            data = await websocket.receive_text()
            # Keep connection alive
    except WebSocketDisconnect:
        manager.disconnect(websocket, quiz_code)

# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
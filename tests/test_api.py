import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as redis
from server import app, mongo_client, db, redis_client
import os

# Test configuration
TEST_MONGO_URL = os.getenv('TEST_MONGO_URL', 'mongodb://localhost:27017')
TEST_REDIS_URL = os.getenv('TEST_REDIS_URL', 'redis://localhost:6379')
TEST_DB_NAME = 'quiz_arena_test'

@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
async def test_db():
    """Setup test database"""
    client = AsyncIOMotorClient(TEST_MONGO_URL)
    database = client[TEST_DB_NAME]
    yield database
    # Cleanup after all tests
    await client.drop_database(TEST_DB_NAME)
    client.close()

@pytest.fixture(scope="session")
async def test_redis():
    """Setup test Redis"""
    client = await redis.from_url(TEST_REDIS_URL, encoding="utf-8", decode_responses=True)
    yield client
    await client.flushdb()
    await client.close()

@pytest.fixture
async def client():
    """Create test client"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.fixture
async def sample_quiz(test_db):
    """Create sample quiz for testing"""
    quiz_data = {
        "code": "TEST01",
        "title": "Test Quiz",
        "description": "A test quiz",
        "duration": 10,
        "status": "active",
        "createdAt": "2024-01-01T00:00:00Z",
        "questionsCount": 2,
        "participantCount": 0,
        "allowedAttempts": 1,
        "shuffleQuestions": False,
        "showCorrectAnswers": True
    }
    
    await test_db.quizzes.insert_one(quiz_data)
    
    questions = [
        {
            "quizCode": "TEST01",
            "index": 0,
            "question": "What is 2+2?",
            "options": ["3", "4", "5", "6"],
            "correctAnswer": 1,
            "timeLimit": 30,
            "points": 10
        },
        {
            "quizCode": "TEST01",
            "index": 1,
            "question": "What is the capital of France?",
            "options": ["London", "Berlin", "Paris", "Madrid"],
            "correctAnswer": 2,
            "timeLimit": 30,
            "points": 10
        }
    ]
    
    await test_db.questions.insert_many(questions)
    
    yield quiz_data
    
    # Cleanup
    await test_db.quizzes.delete_one({"code": "TEST01"})
    await test_db.questions.delete_many({"quizCode": "TEST01"})

# ============================================================================
# HEALTH & INFO TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_root_endpoint(client):
    """Test root endpoint"""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Quiz Arena API"
    assert data["version"] == "2.0.0"
    assert "features" in data

@pytest.mark.asyncio
async def test_health_endpoint(client):
    """Test health check endpoint"""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "database" in data
    assert "cache" in data

# ============================================================================
# QUIZ CREATION TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_create_quiz(client):
    """Test quiz creation"""
    quiz_data = {
        "title": "Python Basics",
        "description": "Test your Python knowledge",
        "duration": 15,
        "questions": [
            {
                "question": "What is Python?",
                "options": ["A snake", "A programming language", "A game", "A movie"],
                "correctAnswer": 1,
                "timeLimit": 30,
                "points": 10
            }
        ]
    }
    
    response = await client.post("/api/admin/quiz", json=quiz_data)
    assert response.status_code == 200
    
    data = response.json()
    assert "code" in data
    assert len(data["code"]) == 6
    assert data["title"] == quiz_data["title"]
    assert data["questionsCount"] == 1

@pytest.mark.asyncio
async def test_create_quiz_validation(client):
    """Test quiz creation with invalid data"""
    invalid_data = {
        "title": "",  # Empty title
        "duration": -1,  # Invalid duration
        "questions": []  # No questions
    }
    
    response = await client.post("/api/admin/quiz", json=invalid_data)
    assert response.status_code == 422  # Validation error

# ============================================================================
# PARTICIPANT TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_join_quiz(client, sample_quiz):
    """Test joining a quiz"""
    join_data = {
        "name": "Test User",
        "quizCode": "TEST01"
    }
    
    response = await client.post("/api/join", json=join_data)
    assert response.status_code == 200
    
    data = response.json()
    assert "id" in data
    assert data["name"] == join_data["name"]
    assert data["quizCode"] == join_data["quizCode"]
    assert data["score"] == 0

@pytest.mark.asyncio
async def test_join_invalid_quiz(client):
    """Test joining non-existent quiz"""
    join_data = {
        "name": "Test User",
        "quizCode": "INVALID"
    }
    
    response = await client.post("/api/join", json=join_data)
    assert response.status_code == 400

@pytest.mark.asyncio
async def test_get_questions(client, sample_quiz, test_db):
    """Test getting quiz questions"""
    # First join the quiz
    join_data = {
        "name": "Test User",
        "quizCode": "TEST01"
    }
    
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    participant_id = participant["id"]
    
    # Get questions
    response = await client.get(
        f"/api/quiz/TEST01/questions?participantId={participant_id}"
    )
    assert response.status_code == 200
    
    data = response.json()
    assert "questions" in data
    assert len(data["questions"]) == 2
    
    # Verify correct answer is not included
    for question in data["questions"]:
        assert "correctAnswer" not in question

# ============================================================================
# ANSWER SUBMISSION TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_submit_correct_answer(client, sample_quiz, test_db):
    """Test submitting correct answer"""
    # Join quiz
    join_data = {"name": "Test User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    
    # Submit correct answer
    answer_data = {
        "participantId": participant["id"],
        "quizCode": "TEST01",
        "questionIndex": 0,
        "selectedOption": 1,  # Correct answer
        "timeTaken": 5.5
    }
    
    response = await client.post("/api/submit-answer", json=answer_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data["correct"] == True
    assert data["points"] > 0

@pytest.mark.asyncio
async def test_submit_wrong_answer(client, sample_quiz, test_db):
    """Test submitting wrong answer"""
    # Join quiz
    join_data = {"name": "Test User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    
    # Submit wrong answer
    answer_data = {
        "participantId": participant["id"],
        "quizCode": "TEST01",
        "questionIndex": 0,
        "selectedOption": 0,  # Wrong answer
        "timeTaken": 10.0
    }
    
    response = await client.post("/api/submit-answer", json=answer_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data["correct"] == False
    assert data["points"] == 0

@pytest.mark.asyncio
async def test_duplicate_answer(client, sample_quiz, test_db):
    """Test submitting answer twice"""
    # Join quiz
    join_data = {"name": "Test User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    
    # Submit answer
    answer_data = {
        "participantId": participant["id"],
        "quizCode": "TEST01",
        "questionIndex": 0,
        "selectedOption": 1,
        "timeTaken": 5.0
    }
    
    # First submission should succeed
    response1 = await client.post("/api/submit-answer", json=answer_data)
    assert response1.status_code == 200
    
    # Second submission should fail
    response2 = await client.post("/api/submit-answer", json=answer_data)
    assert response2.status_code == 400

# ============================================================================
# LEADERBOARD TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_leaderboard(client, sample_quiz, test_db):
    """Test leaderboard calculation"""
    # Create multiple participants
    participants = []
    
    for i, name in enumerate(["Alice", "Bob", "Charlie"]):
        join_data = {"name": name, "quizCode": "TEST01"}
        join_response = await client.post("/api/join", json=join_data)
        participant = join_response.json()
        participants.append(participant)
        
        # Submit answers with different scores
        answer_data = {
            "participantId": participant["id"],
            "quizCode": "TEST01",
            "questionIndex": 0,
            "selectedOption": 1 if i < 2 else 0,  # First 2 correct
            "timeTaken": 5.0 + i
        }
        
        await client.post("/api/submit-answer", json=answer_data)
        
        # Mark as completed
        await test_db.participants.update_one(
            {"id": participant["id"]},
            {"$set": {"completedAt": "2024-01-01T00:00:00Z"}}
        )
    
    # Get leaderboard
    response = await client.get("/api/leaderboard/TEST01")
    assert response.status_code == 200
    
    leaderboard = response.json()
    assert len(leaderboard) == 3
    
    # Verify ranking (higher score first, then lower time)
    assert leaderboard[0]["name"] == "Alice"
    assert leaderboard[0]["rank"] == 1
    assert leaderboard[1]["name"] == "Bob"
    assert leaderboard[1]["rank"] == 2

# ============================================================================
# PROGRESS SAVE TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_save_progress(client, sample_quiz, test_db):
    """Test saving progress"""
    # Join quiz
    join_data = {"name": "Test User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    
    # Save progress
    progress_data = {
        "participantId": participant["id"],
        "quizCode": "TEST01",
        "currentQuestion": 1,
        "answers": [
            {
                "questionIndex": 0,
                "selectedOption": 1,
                "isCorrect": True
            }
        ]
    }
    
    response = await client.post("/api/save-progress", json=progress_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data["success"] == True

@pytest.mark.asyncio
async def test_restore_session(client, sample_quiz, test_db):
    """Test restoring session"""
    # Join quiz
    join_data = {"name": "Test User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    participant_id = participant["id"]
    
    # Save progress
    progress_data = {
        "participantId": participant_id,
        "quizCode": "TEST01",
        "currentQuestion": 1,
        "answers": [{"questionIndex": 0, "selectedOption": 1}]
    }
    
    await client.post("/api/save-progress", json=progress_data)
    
    # Restore session
    response = await client.get(f"/api/restore-session/{participant_id}")
    assert response.status_code == 200
    
    data = response.json()
    assert data["currentQuestion"] == 1
    assert len(data["answers"]) == 1

# ============================================================================
# ADMIN TESTS
# ============================================================================

@pytest.mark.asyncio
async def test_get_all_quizzes(client, sample_quiz):
    """Test getting all quizzes"""
    response = await client.get("/api/admin/quizzes")
    assert response.status_code == 200
    
    quizzes = response.json()
    assert isinstance(quizzes, list)
    assert len(quizzes) >= 1

@pytest.mark.asyncio
async def test_get_quiz_details(client, sample_quiz):
    """Test getting quiz details"""
    response = await client.get("/api/admin/quiz/TEST01")
    assert response.status_code == 200
    
    quiz = response.json()
    assert quiz["code"] == "TEST01"
    assert "questions" in quiz
    assert len(quiz["questions"]) == 2

@pytest.mark.asyncio
async def test_update_quiz_status(client, sample_quiz):
    """Test updating quiz status"""
    response = await client.patch(
        "/api/admin/quiz/TEST01/status?status=inactive"
    )
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "inactive"

@pytest.mark.asyncio
async def test_get_participants(client, sample_quiz, test_db):
    """Test getting quiz participants"""
    # Add some participants
    for name in ["User1", "User2"]:
        join_data = {"name": name, "quizCode": "TEST01"}
        await client.post("/api/join", json=join_data)
    
    response = await client.get("/api/admin/quiz/TEST01/participants")
    assert response.status_code == 200
    
    data = response.json()
    assert data["count"] >= 2
    assert len(data["participants"]) >= 2

@pytest.mark.asyncio
async def test_get_statistics(client, sample_quiz, test_db):
    """Test getting quiz statistics"""
    response = await client.get("/api/admin/quiz/TEST01/statistics")
    assert response.status_code == 200
    
    stats = response.json()
    assert "totalParticipants" in stats
    assert "averageScore" in stats
    assert "completionRate" in stats
    assert "questionStats" in stats

# ============================================================================
# EDGE CASES
# ============================================================================

@pytest.mark.asyncio
async def test_unauthorized_access(client):
    """Test accessing questions without valid participant ID"""
    response = await client.get("/api/quiz/TEST01/questions?participantId=invalid")
    assert response.status_code == 403

@pytest.mark.asyncio
async def test_quiz_time_bonus(client, sample_quiz, test_db):
    """Test time bonus calculation"""
    # Join quiz
    join_data = {"name": "Fast User", "quizCode": "TEST01"}
    join_response = await client.post("/api/join", json=join_data)
    participant = join_response.json()
    
    # Submit answer very quickly
    answer_data = {
        "participantId": participant["id"],
        "quizCode": "TEST01",
        "questionIndex": 0,
        "selectedOption": 1,
        "timeTaken": 2.0  # Very fast
    }
    
    response = await client.post("/api/submit-answer", json=answer_data)
    data = response.json()
    
    assert data["correct"] == True
    assert data["timeBonus"] > 0  # Should get time bonus
    assert data["points"] > data["basePoints"]
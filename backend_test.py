import requests
import sys
import json
from datetime import datetime

class QuizAPITester:
    def __init__(self, base_url="https://quiz-arena-38.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.quiz_code = None
        self.participant_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.api_base}{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {method} {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PATCH':
                response = requests.patch(url, headers=headers, params=params, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"   Response: {response.json()}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except requests.exceptions.Timeout:
            print(f"❌ Failed - Request timeout")
            return False, {}
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test basic API health"""
        return self.run_test("Health Check", "GET", "/", 200)

    def test_create_quiz(self):
        """Test quiz creation"""
        quiz_data = {
            "title": "Test Quiz API",
            "duration": 15,
            "questions": [
                {
                    "question": "What is 2 + 2?",
                    "options": ["3", "4", "5", "6"],
                    "correctAnswer": 1,
                    "timeLimit": 30
                }
            ]
        }
        
        success, response = self.run_test(
            "Create Quiz",
            "POST",
            "/admin/quiz",
            200,
            data=quiz_data
        )
        
        if success and 'code' in response:
            self.quiz_code = response['code']
            print(f"   Quiz Code: {self.quiz_code}")
            return True
        return False

    def test_get_all_quizzes(self):
        """Test getting all quizzes"""
        success, response = self.run_test(
            "Get All Quizzes",
            "GET",
            "/admin/quizzes",
            200
        )
        
        if success:
            print(f"   Found {len(response)} quizzes")
            return True
        return False

    def test_join_quiz(self):
        """Test joining a quiz"""
        if not self.quiz_code:
            print("❌ Cannot test join - no quiz code available")
            return False
        
        join_data = {
            "name": f"TestPlayer_{datetime.now().strftime('%H%M%S')}",
            "quizCode": self.quiz_code
        }
        
        success, response = self.run_test(
            "Join Quiz",
            "POST",
            "/join",
            200,
            data=join_data
        )
        
        if success and 'id' in response:
            self.participant_id = response['id']
            print(f"   Participant ID: {self.participant_id}")
            return True
        return False

    def test_get_questions(self):
        """Test getting quiz questions"""
        if not self.quiz_code or not self.participant_id:
            print("❌ Cannot test questions - missing quiz code or participant ID")
            return False
        
        success, response = self.run_test(
            "Get Quiz Questions",
            "GET",
            f"/quiz/{self.quiz_code}/questions",
            200,
            params={"participantId": self.participant_id}
        )
        
        if success and 'questions' in response:
            print(f"   Found {len(response['questions'])} questions")
            return True
        return False

    def test_submit_answer(self):
        """Test submitting an answer"""
        if not self.quiz_code or not self.participant_id:
            print("❌ Cannot test answer submission - missing quiz code or participant ID")
            return False
        
        answer_data = {
            "participantId": self.participant_id,
            "quizCode": self.quiz_code,
            "questionIndex": 0,
            "selectedOption": 1,  # Correct answer for "What is 2 + 2?"
            "timeTaken": 5.5
        }
        
        success, response = self.run_test(
            "Submit Answer",
            "POST",
            "/submit-answer",
            200,
            data=answer_data
        )
        
        if success:
            print(f"   Correct: {response.get('correct', 'N/A')}")
            print(f"   Points: {response.get('points', 'N/A')}")
            return True
        return False

    def test_get_leaderboard(self):
        """Test getting leaderboard"""
        if not self.quiz_code:
            print("❌ Cannot test leaderboard - no quiz code available")
            return False
        
        success, response = self.run_test(
            "Get Leaderboard",
            "GET",
            f"/leaderboard/{self.quiz_code}",
            200
        )
        
        if success:
            print(f"   Leaderboard entries: {len(response)}")
            return True
        return False

    def test_update_quiz_status(self):
        """Test updating quiz status"""
        if not self.quiz_code:
            print("❌ Cannot test status update - no quiz code available")
            return False
        
        success, response = self.run_test(
            "Update Quiz Status",
            "PATCH",
            f"/admin/quiz/{self.quiz_code}/status",
            200,
            params={"status": "inactive"}
        )
        
        return success

def main():
    print("🚀 Starting Quiz API Testing...")
    print("=" * 50)
    
    tester = QuizAPITester()
    
    # Test sequence
    tests = [
        ("Health Check", tester.test_health_check),
        ("Create Quiz", tester.test_create_quiz),
        ("Get All Quizzes", tester.test_get_all_quizzes),
        ("Join Quiz", tester.test_join_quiz),
        ("Get Questions", tester.test_get_questions),
        ("Submit Answer", tester.test_submit_answer),
        ("Get Leaderboard", tester.test_get_leaderboard),
        ("Update Quiz Status", tester.test_update_quiz_status),
    ]
    
    failed_tests = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            if not result:
                failed_tests.append(test_name)
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {str(e)}")
            failed_tests.append(test_name)
    
    print("\n" + "=" * 50)
    print("📊 FINAL RESULTS")
    print(f"✅ Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    if failed_tests:
        print(f"❌ Failed tests: {', '.join(failed_tests)}")
        return 1
    else:
        print("🎉 All tests passed!")
        return 0

if __name__ == "__main__":
    sys.exit(main())
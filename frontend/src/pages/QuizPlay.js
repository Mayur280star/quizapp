import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Timer, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const QuizPlay = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [startTime, setStartTime] = useState(null);

  useEffect(() => {
    // Prevent right-click
    const preventRightClick = (e) => e.preventDefault();
    document.addEventListener('contextmenu', preventRightClick);

    // Detect tab switch
    const handleVisibilityChange = () => {
      if (document.hidden) {
        toast.warning('Tab switch detected!');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('contextmenu', preventRightClick);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const pid = localStorage.getItem('participantId');
    if (!pid) {
      toast.error('Please join the quiz first');
      navigate('/join');
      return;
    }
    setParticipantId(pid);
    fetchQuestions(pid);
  }, []);

  useEffect(() => {
    if (questions.length > 0 && currentIndex < questions.length) {
      setTimeLeft(questions[currentIndex].timeLimit);
      setStartTime(Date.now());
      setSelectedOption(null);
      setAnswered(false);
      setResult(null);
    }
  }, [currentIndex, questions]);

  useEffect(() => {
    if (timeLeft > 0 && !answered) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && !answered && questions.length > 0) {
      handleAutoSubmit();
    }
  }, [timeLeft, answered]);

  const fetchQuestions = async (pid) => {
    try {
      const response = await axios.get(`${API}/quiz/${code}/questions?participantId=${pid}`);
      setQuestions(response.data.questions);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching questions:', error);
      toast.error('Failed to load quiz');
      navigate('/join');
    }
  };

  const handleAutoSubmit = async () => {
    if (answered) return;
    setAnswered(true);
    
    const timeTaken = (Date.now() - startTime) / 1000;
    
    try {
      const response = await axios.post(`${API}/submit-answer`, {
        participantId,
        quizCode: code,
        questionIndex: questions[currentIndex].index,
        selectedOption: selectedOption !== null ? selectedOption : -1,
        timeTaken
      });
      
      setResult(response.data);
      toast.error('Time up!');
      
      setTimeout(() => {
        if (currentIndex < questions.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          navigate(`/leaderboard/${code}`);
        }
      }, 2000);
    } catch (error) {
      console.error('Error submitting answer:', error);
      toast.error('Failed to submit answer');
    }
  };

  const handleSubmit = async () => {
    if (selectedOption === null || answered) return;
    
    setAnswered(true);
    const timeTaken = (Date.now() - startTime) / 1000;
    
    try {
      const response = await axios.post(`${API}/submit-answer`, {
        participantId,
        quizCode: code,
        questionIndex: questions[currentIndex].index,
        selectedOption,
        timeTaken
      });
      
      setResult(response.data);
      
      if (response.data.correct) {
        toast.success('Correct! +10 points');
      } else {
        toast.error('Wrong answer');
      }
      
      setTimeout(() => {
        if (currentIndex < questions.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          navigate(`/leaderboard/${code}`);
        }
      }, 2000);
    } catch (error) {
      console.error('Error submitting answer:', error);
      toast.error('Failed to submit answer');
    }
  };

  if (loading) {
    return (
      <div className="quiz-theme min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="quiz-theme min-h-screen flex items-center justify-center p-6">
        <div className="glass-card rounded-2xl p-8 text-center" data-testid="no-questions-message">
          <p className="text-xl">No questions available</p>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="quiz-theme min-h-screen flex flex-col">
      {/* Progress Bar */}
      <div className="w-full h-2 bg-black/40">
        <motion.div 
          className="h-full bg-gradient-to-r from-[#FF6B00] to-[#9D00FF]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
          data-testid="progress-bar"
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {/* Timer */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="mb-6 flex justify-center"
          >
            <div 
              className={`flex items-center gap-3 px-6 py-3 rounded-full font-bold text-xl ${
                timeLeft <= 5 ? 'bg-red-500 pulse-glow' : 'bg-[#9D00FF]'
              }`}
              data-testid="timer-display"
            >
              <Timer className="w-6 h-6" />
              {timeLeft}s
            </div>
          </motion.div>

          {/* Question Card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="glass-card rounded-3xl p-8 mb-6"
            >
              <div className="mb-4 flex justify-between items-center">
                <span className="text-sm font-bold text-[#00FF94]" data-testid="question-counter">
                  Question {currentIndex + 1} of {questions.length}
                </span>
              </div>

              <h2 
                className="text-2xl md:text-3xl font-bold mb-8"
                style={{ fontFamily: 'Fredoka, sans-serif' }}
                data-testid="question-text"
              >
                {currentQuestion.question}
              </h2>

              <div className="space-y-4">
                {currentQuestion.options.map((option, index) => {
                  const isSelected = selectedOption === index;
                  const isCorrect = result && result.correctAnswer === index;
                  const isWrong = result && selectedOption === index && !result.correct;
                  
                  let buttonClass = 'bg-white/10 border-2 border-white/20 hover:border-[#FF6B00] hover:bg-white/20';
                  
                  if (answered) {
                    if (isCorrect) {
                      buttonClass = 'bg-green-500 border-green-500';
                    } else if (isWrong) {
                      buttonClass = 'bg-red-500 border-red-500';
                    }
                  } else if (isSelected) {
                    buttonClass = 'bg-[#FF6B00] border-[#FF6B00]';
                  }

                  return (
                    <motion.button
                      key={index}
                      whileHover={!answered ? { scale: 1.02 } : {}}
                      whileTap={!answered ? { scale: 0.98 } : {}}
                      onClick={() => !answered && setSelectedOption(index)}
                      disabled={answered}
                      className={`w-full p-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-between ${buttonClass}`}
                      data-testid={`option-${index}`}
                    >
                      <span>{option}</span>
                      {answered && isCorrect && <Check className="w-6 h-6" />}
                      {answered && isWrong && <X className="w-6 h-6" />}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Submit Button */}
          {!answered && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleSubmit}
              disabled={selectedOption === null}
              className="w-full bg-[#00FF94] text-black font-bold py-5 rounded-full border-b-4 border-[#00CC77] hover:brightness-110 transition-all text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
              data-testid="submit-answer-button"
            >
              Submit Answer
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizPlay;
// QuizPlay.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Check, X, BarChart3, Users, Zap, Trophy, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;





const ANSWER_COLORS = [
  { bg: '#E21B3C', hover: '#C41830', shape: 'triangle', name: 'Red' },
  { bg: '#1368CE', hover: '#0F57B0', shape: 'diamond', name: 'Blue' },
  { bg: '#D89E00', hover: '#B88500', shape: 'circle', name: 'Yellow' },
  { bg: '#26890C', hover: '#1F6F0A', shape: 'square', name: 'Green' }
];

const SHAPE_ICONS = {
  triangle: () => (
    <div className="w-0 h-0 border-l-[20px] md:border-l-[24px] border-l-transparent border-r-[20px] md:border-r-[24px] border-r-transparent border-b-[34px] md:border-b-[40px] border-b-white"></div>
  ),
  diamond: () => (
    <div className="w-10 h-10 md:w-12 md:h-12 bg-white transform rotate-45"></div>
  ),
  circle: () => (
    <div className="w-12 h-12 md:w-16 md:h-16 bg-white rounded-full"></div>
  ),
  square: () => (
    <div className="w-12 h-12 md:w-16 md:h-16 bg-white"></div>
  )
};

const QuizPlay = () => {

  const resetQuestionState = useCallback(() => {
  setQuestionStarted(false);
  setAnswered(false);
  setResult(null);
  setSelectedOption(null);
  setShowAnswerReveal(false);
  setAnsweredCount(0);
  setStartTime(null);
  setTimeLeft(0);
}, []);

  
  const { code } = useParams();
  const navigate = useNavigate();
  
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  
  const [selectedOption, setSelectedOption] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState(null);
  const [showAnswerReveal, setShowAnswerReveal] = useState(false);
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [questionStarted, setQuestionStarted] = useState(false);
  
  const [score, setScore] = useState(0);
  
  const wsRef = useRef(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);
  
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const participantId = localStorage.getItem('participantId');


  const [serverQuestionIndex, setServerQuestionIndex] = useState(0);
  const [quizState, setQuizState] = useState('lobby');


  const fetchQuestions = useCallback(async () => {
    try {
      const pid = isAdmin ? 'admin' : participantId;
      const response = await axios.get(`${API}/quiz/${code}/questions`, {
        params: { participantId: pid }
      });
      
      setQuestions(response.data.questions || []);
      setLoading(false);
    } catch (error) {
      console.error('Fetch questions error:', error);
      toast.error('Failed to load questions');
      navigate('/join');
    }
  }, [code, navigate, isAdmin, participantId]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const socket = new WebSocket(`${wsUrl}/ws/${code}`);
    wsRef.current = socket;

    socket.onopen = () => {
  console.log('✓ QuizPlay WebSocket connected');

  if (isAdmin) {
    socket.send(JSON.stringify({ type: 'admin_joined', code }));
  } else {
    socket.send(JSON.stringify({
      type: 'participant_joined',
      participantId
    }));
  }
};


    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('QuizPlay received:', data);
      
      switch (data.type) {
  case 'answer_count': {
    setAnsweredCount(data.answeredCount);
    setTotalParticipants(data.totalParticipants);
    break;
  }

  case 'quiz_starting': {
    setQuizState('question');
    const qIndex = typeof data.current_question === 'number' ? data.current_question : 0;
    setServerQuestionIndex(qIndex);
    setCurrentIndex(qIndex);
    resetQuestionState();
    break;
  }

  case 'next_question': {
    setQuizState('question');
    if (typeof data.current_question === 'number') {
      setServerQuestionIndex(data.current_question);
      setCurrentIndex(data.current_question); // UI only
      resetQuestionState();
    }
    break;
  }

  case 'show_answer': {
    setShowAnswerReveal(true);
    if (!isAdmin && result?.correct) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
    break;
  }

  case 'show_leaderboard': {
    setQuizState('leaderboard');
    const questionParam =
      typeof data.current_question === 'number'
        ? data.current_question
        : serverQuestionIndex;

    navigate(`/leaderboard/${code}?question=${questionParam}`);
    break;
  }

  case 'show_podium': {
    setQuizState('podium');
    navigate(`/podium/${code}`);
    break;
  }

  case 'ping': {
    socket.send(JSON.stringify({ type: 'pong' }));
    break;
  }

  default:
    break;
}

    };

    socket.onerror = (error) => {
      console.error('QuizPlay WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('QuizPlay WebSocket closed');
      wsRef.current = null;
      setTimeout(connectWebSocket, 3000);
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [code, currentIndex, navigate, questions.length, isAdmin, result]);

  useEffect(() => {
    if (!participantId && !isAdmin) {
      toast.error('Please join the quiz first');
      navigate('/join');
      return;
    }
    
    fetchQuestions();
  }, [participantId, isAdmin, navigate, fetchQuestions]);

  useEffect(() => {
    if (questions.length > 0) {
      const cleanup = connectWebSocket();
      return cleanup;
    }
  }, [questions.length, connectWebSocket]);

  useEffect(() => {
    if (questions.length > 0 && currentIndex < questions.length && !questionStarted) {
      setQuestionStarted(true);
      setTimeLeft(questions[currentIndex].timeLimit || 20);
      setStartTime(Date.now());
    }
  }, [currentIndex, questions, questionStarted]);

  useEffect(() => {
    if (timeLeft > 0 && !answered && questionStarted && !isAdmin) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && !answered && questions.length > 0 && questionStarted && !isAdmin) {
      handleAutoSubmit();
    }
  }, [timeLeft, answered, questions.length, questionStarted, isAdmin]);

  const handleAutoSubmit = useCallback(() => {
  if (answered || isAdmin) return;

  setAnswered(true);
  toast.error("⏰ Time's up!");

  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({
      type: 'auto_submit',
      participantId,
      questionIndex: serverQuestionIndex
    }));
  }
}, [answered, isAdmin, participantId, serverQuestionIndex]);



  const handleSubmit = async () => {
if (selectedOption === null || answered || isAdmin) return;
    
    setAnswered(true);
    const timeTaken = (Date.now() - startTime) / 1000;
    
    try {
      const response = await axios.post(`${API}/submit-answer`, {
        participantId,
        quizCode: code,
        questionIndex: serverQuestionIndex,
        selectedOption,
        timeTaken
      });
      
      setResult(response.data);
      
      if (response.data.correct) {
        const newScore = score + response.data.points;
        setScore(newScore);
        toast.success(`🎉 Correct! +${response.data.points} points`);
      } else {
        toast.error('❌ Wrong answer');
      }
      
      
    } catch (error) {
      console.error('Submit answer error:', error);
      const errorMsg = error.response?.data?.detail || 'Failed to submit answer';
      toast.error(errorMsg);
      setAnswered(false);
    }
  };

  const handleShowAnswer = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'show_answer' }));
    }
  };

  const handleShowLeaderboard = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'show_leaderboard' }));
    }
  };

  const isImageUrl = (text) => {
    if (!text || typeof text !== 'string') return false;
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(text) || 
           text.startsWith('http') && (text.includes('image') || text.includes('img'));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#46178F] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 md:w-20 md:h-20 border-6 md:border-8 border-white border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen bg-[#46178F] flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="bg-white rounded-3xl p-6 md:p-8 text-center shadow-2xl max-w-md"
        >
          <div className="text-5xl md:text-6xl mb-4">📝</div>
          <p className="text-xl md:text-2xl font-bold text-gray-800 mb-2">No questions available</p>
          <p className="text-gray-600">Please check the quiz configuration</p>
          <Button
            onClick={() => navigate('/admin')}
            className="mt-6"
          >
            Back to Admin
          </Button>
        </motion.div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <div className="min-h-screen bg-[#46178F] relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            initial={{ 
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920),
              y: -50,
              scale: Math.random() * 0.5 + 0.5
            }}
            animate={{ 
              y: (typeof window !== 'undefined' ? window.innerHeight : 1080) + 50,
            }}
            transition={{ 
              duration: Math.random() * 5 + 5,
              repeat: Infinity,
              delay: Math.random() * 5
            }}
          >
            <div className="w-2 h-2 bg-white/30 rounded-full" />
          </motion.div>
        ))}
      </div>

      <div className="absolute top-0 left-0 right-0 bg-white/10 backdrop-blur-md py-3 md:py-4 px-4 md:px-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 md:gap-4">
          <div className="text-white text-lg md:text-2xl font-bold">
            <span className="text-yellow-300">Question</span> {serverQuestionIndex + 1} of {questions.length}
          </div>
          
          {!isAdmin && (
            <div className="flex items-center gap-2 bg-white/20 rounded-full px-3 md:px-4 py-1 md:py-2">
              <Trophy className="w-4 h-4 md:w-5 md:h-5 text-yellow-300" />
              <span className="text-white text-base md:text-xl font-semibold">{score}</span>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 md:gap-4">
            <div className="text-white text-sm md:text-lg font-semibold flex items-center gap-2 bg-white/20 rounded-full px-3 md:px-4 py-1 md:py-2">
              <Users className="w-4 h-4 md:w-5 md:h-5" />
              <span>{answeredCount} / {totalParticipants}</span>
            </div>
          </div>
        )}
      </div>

      <div className="pt-16 md:pt-24 pb-8 md:pb-12 px-4 md:px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div
            key={`question-${currentIndex}`}
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", duration: 0.6 }}
            className="bg-white rounded-2xl md:rounded-3xl p-4 md:p-12 shadow-2xl mb-6 md:mb-12 text-center relative overflow-hidden"
          >
            {!isAdmin && (
              <motion.div
                className="inline-block mb-4 md:mb-8"
                animate={timeLeft <= 5 ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 0.5, repeat: timeLeft <= 5 ? Infinity : 0 }}
              >
                <div className={`w-20 h-20 md:w-32 md:h-32 rounded-full flex items-center justify-center text-3xl md:text-5xl font-black transition-all duration-300 ${
                  timeLeft <= 5 ? 'bg-red-500 text-white animate-pulse' : 
                  timeLeft <= 10 ? 'bg-orange-500 text-white' :
                  'bg-gray-200 text-gray-700'
                }`}>
                  {timeLeft}
                </div>
              </motion.div>
            )}

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="max-w-4xl mx-auto"
            >
              {isImageUrl(currentQuestion.question) ? (
                <img 
                  src={currentQuestion.question} 
                  alt="Question" 
                  className="w-full max-h-[300px] md:max-h-[400px] object-contain rounded-lg mb-4 mx-auto"
                />
              ) : (
                <h2 
                  className="text-2xl md:text-5xl font-black text-gray-900 leading-tight px-2 md:px-4"
                  style={{ 
                    fontFamily: 'Fredoka, sans-serif',
                    fontSize: 'clamp(1.5rem, 5vw, 3rem)'
                  }}
                >
                  {currentQuestion.question}
                </h2>
              )}
            </motion.div>

            {currentQuestion.media && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-4 md:mt-6"
              >
                <img 
                  src={currentQuestion.media} 
                  alt="Question media" 
                  className="w-full max-h-[250px] md:max-h-[350px] object-contain rounded-lg mx-auto"
                />
              </motion.div>
            )}

            <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-200">
              <motion.div
                className="h-full bg-purple-600"
                initial={{ width: '0%' }}
                animate={{ width: `${((serverQuestionIndex + 1) / questions.length) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-8">
            {currentQuestion.options.map((option, index) => {
              const colorScheme = ANSWER_COLORS[index];
              const isSelected = selectedOption === index;
              const isCorrect = showAnswerReveal && result && result.correctAnswer === index;
              const isWrong = showAnswerReveal && result && selectedOption === index && !result.correct;
              const ShapeIcon = SHAPE_ICONS[colorScheme.shape];

              let buttonStyle = {};
              let borderStyle = '';
              
              if (showAnswerReveal) {
                if (isCorrect) {
                  buttonStyle = { backgroundColor: '#10B981' };
                  borderStyle = 'ring-4 md:ring-8 ring-green-400';
                } else if (isWrong) {
                  buttonStyle = { backgroundColor: '#EF4444' };
                  borderStyle = 'ring-4 md:ring-8 ring-red-400';
                } else {
                  buttonStyle = { backgroundColor: colorScheme.bg, opacity: 0.6 };
                }
              } else {
                buttonStyle = { 
                  backgroundColor: isSelected ? colorScheme.hover : colorScheme.bg 
                };
                if (isSelected) {
                  borderStyle = 'ring-4 md:ring-8 ring-white scale-105';
                }
              }

              const isOptionImage = isImageUrl(option);

              return (
                <motion.button
                  key={index}
                  initial={{ scale: 0, opacity: 0, rotate: -90 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ 
                    delay: 0.3 + index * 0.1, 
                    type: "spring",
                    stiffness: 200
                  }}
                  whileHover={!answered && !isAdmin ? { scale: 1.05, y: -5 } : {}}
                  whileTap={!answered && !isAdmin ? { scale: 0.95 } : {}}
                  onClick={() => !answered && !isAdmin && setSelectedOption(index)}
                  disabled={answered || isAdmin}
                  style={buttonStyle}
                  className={`
                    relative overflow-hidden rounded-xl md:rounded-3xl p-4 md:p-8
                    transition-all duration-300 shadow-2xl
                    ${borderStyle}
                    ${(answered || isAdmin) ? 'cursor-not-allowed' : 'cursor-pointer'}
                    ${isOptionImage ? 'min-h-[120px] md:min-h-[200px]' : 'min-h-[80px] md:min-h-[140px]'}
                  `}
                >
                  <div className="absolute top-2 left-2 md:top-8 md:left-8">
                    <div className="scale-75 md:scale-100">
                      <ShapeIcon />
                    </div>
                  </div>

                  <div className={`${isOptionImage ? 'pt-12 md:pt-16' : 'text-left pl-12 md:pl-24 pr-2 md:pr-4'}`}>
                    {isOptionImage ? (
                      <img 
                        src={option} 
                        alt={`Option ${index + 1}`}
                        className="w-full max-h-[150px] md:max-h-[200px] object-contain rounded-lg"
                      />
                    ) : (
                      <span className="text-base md:text-4xl font-bold text-white leading-tight break-words"
                        style={{
                          fontSize: 'clamp(1rem, 3vw, 2.25rem)'
                        }}
                      >
                        {option}
                      </span>
                    )}
                  </div>

                  <AnimatePresence>
                    {showAnswerReveal && (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", delay: 0.2 }}
                        className="absolute top-2 right-2 md:top-8 md:right-8"
                      >
                        {isCorrect && (
                          <div className="w-10 h-10 md:w-16 md:h-16 bg-white rounded-full flex items-center justify-center">
                            <Check className="w-6 h-6 md:w-10 md:h-10 text-green-500" strokeWidth={4} />
                          </div>
                        )}
                        {isWrong && (
                          <div className="w-10 h-10 md:w-16 md:h-16 bg-white rounded-full flex items-center justify-center">
                            <X className="w-6 h-6 md:w-10 md:h-10 text-red-500" strokeWidth={4} />
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isSelected && !showAnswerReveal && (
                    <motion.div
                      className="absolute inset-0 bg-white"
                      initial={{ opacity: 0.3 }}
                      animate={{ opacity: [0.3, 0, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence>
            {!isAdmin && !answered && selectedOption !== null && (
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className="flex justify-center mt-8 md:mt-12"
              >
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    onClick={handleSubmit}
                    size="lg"
                    className="bg-white text-purple-600 hover:bg-gray-100 font-black text-xl md:text-3xl px-8 md:px-16 py-6 md:py-8 rounded-full shadow-2xl"
                    style={{ fontFamily: 'Fredoka, sans-serif' }}
                  >
                    <Zap className="w-6 h-6 md:w-8 md:h-8 mr-2 md:mr-3" />
                    Submit Answer
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isAdmin && answered && !showAnswerReveal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-8 md:mt-12"
            >
              <motion.p
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-white text-lg md:text-2xl font-semibold"
              >
                ⏳ Waiting for others to answer...
              </motion.p>
            </motion.div>
          )}

          <AnimatePresence>
            {isAdmin && (
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="flex flex-col md:flex-row justify-center gap-4 md:gap-6 mt-8 md:mt-12"
              >
                {!showAnswerReveal && (
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-full md:w-auto"
                  >
                    <Button
                      onClick={handleShowAnswer}
                      size="lg"
                      className="w-full md:w-auto bg-orange-500 hover:bg-orange-600 text-white font-black text-xl md:text-2xl px-8 md:px-12 py-6 md:py-8 rounded-full shadow-2xl"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      Show Answers
                    </Button>
                  </motion.div>
                )}

                {showAnswerReveal && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-full md:w-auto"
                  >
                    <Button
                      onClick={handleShowLeaderboard}
                      size="lg"
                      className="w-full md:w-auto bg-blue-500 hover:bg-blue-600 text-white font-black text-xl md:text-2xl px-8 md:px-12 py-6 md:py-8 rounded-full shadow-2xl flex items-center justify-center gap-3 md:gap-4"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      <BarChart3 className="w-6 h-6 md:w-8 md:h-8" />
                      Show Leaderboard
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <style jsx>{`
        .break-words {
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: auto;
        }
      `}</style>
    </div>
  );
};

export default QuizPlay;
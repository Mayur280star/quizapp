import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Check, X, BarChart3, Users, Zap, Trophy } from 'lucide-react';
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
    <div className="w-0 h-0 border-l-[24px] border-l-transparent border-r-[24px] border-r-transparent border-b-[40px] border-b-white"></div>
  ),
  diamond: () => (
    <div className="w-12 h-12 bg-white transform rotate-45"></div>
  ),
  circle: () => (
    <div className="w-16 h-16 bg-white rounded-full"></div>
  ),
  square: () => (
    <div className="w-16 h-16 bg-white"></div>
  )
};

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
  const [startTime, setStartTime] = useState(null);
  const [score, setScore] = useState(0);
  const [showAnswerReveal, setShowAnswerReveal] = useState(false);
  const wsRef = useRef(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [questionStarted, setQuestionStarted] = useState(false);
  
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const participantId = localStorage.getItem('participantId');

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
      if (isAdmin) {
        socket.send(JSON.stringify({ type: 'admin_joined', code }));
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'answer_count':
          setAnsweredCount(data.answeredCount);
          setTotalParticipants(data.totalParticipants);
          break;
          
        case 'show_answer':
          setShowAnswerReveal(true);
          if (!isAdmin && result?.correct) {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 }
            });
          }
          break;
          
        case 'show_leaderboard':
          navigate(`/leaderboard/${code}?question=${currentIndex}`);
          break;
          
        case 'next_question':
          const nextIdx = currentIndex + 1;
          if (nextIdx < questions.length) {
            setCurrentIndex(nextIdx);
            setQuestionStarted(false);
            setAnswered(false);
            setResult(null);
            setSelectedOption(null);
            setShowAnswerReveal(false);
            setAnsweredCount(0);
          } else {
            navigate(`/podium/${code}`);
          }
          break;

        case 'ping':
          socket.send(JSON.stringify({ type: 'pong' }));
          break;
          
        default:
          break;
      }
    };

    socket.onerror = (error) => {
      console.error('Quiz WebSocket error:', error);
    };

    socket.onclose = () => {
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

  const handleAutoSubmit = useCallback(async () => {
    if (answered || isAdmin) return;
    setAnswered(true);
    
    const timeTaken = (Date.now() - startTime) / 1000;
    
    try {
      const response = await axios.post(`${API}/submit-answer`, {
        participantId,
        quizCode: code,
        questionIndex: currentIndex,
        selectedOption: selectedOption !== null ? selectedOption : -1,
        timeTaken
      });
      
      setResult(response.data);
      toast.error("⏰ Time's up!");
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ 
          type: 'answer_submitted',
          participantId 
        }));
      }
    } catch (error) {
      console.error('Auto-submit error:', error);
    }
  }, [answered, isAdmin, startTime, participantId, code, currentIndex, selectedOption]);

  const handleSubmit = async () => {
    if (selectedOption === null || answered || isAdmin) return;
    
    setAnswered(true);
    const timeTaken = (Date.now() - startTime) / 1000;
    
    try {
      const response = await axios.post(`${API}/submit-answer`, {
        participantId,
        quizCode: code,
        questionIndex: currentIndex,
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
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ 
          type: 'answer_submitted',
          participantId 
        }));
      }
    } catch (error) {
      console.error('Submit answer error:', error);
      toast.error('Failed to submit answer');
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#46178F] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-20 h-20 border-8 border-white border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen bg-[#46178F] flex items-center justify-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="bg-white rounded-3xl p-8 text-center shadow-2xl max-w-md"
        >
          <div className="text-6xl mb-4">📝</div>
          <p className="text-2xl font-bold text-gray-800 mb-2">No questions available</p>
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

      <div className="absolute top-0 left-0 right-0 bg-white/10 backdrop-blur-md py-4 px-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="text-white text-2xl font-bold">
            Question {currentIndex + 1} of {questions.length}
          </div>
          
          {!isAdmin && (
            <div className="flex items-center gap-2 bg-white/20 rounded-full px-4 py-2">
              <Trophy className="w-5 h-5 text-yellow-300" />
              <span className="text-white text-xl font-semibold">{score}</span>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-4">
            <div className="text-white text-lg font-semibold flex items-center gap-2 bg-white/20 rounded-full px-4 py-2">
              <Users className="w-5 h-5" />
              <span>{answeredCount} / {totalParticipants}</span>
            </div>
          </div>
        )}
      </div>

      <div className="pt-24 pb-12 px-8">
        <div className="max-w-6xl mx-auto">
          <motion.div
            key={`question-${currentIndex}`}
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", duration: 0.6 }}
            className="bg-white rounded-3xl p-12 shadow-2xl mb-12 text-center relative overflow-hidden"
          >
            {!isAdmin && (
              <motion.div
                className="inline-block mb-8"
                animate={timeLeft <= 5 ? { 
                  scale: [1, 1.2, 1],
                } : {}}
                transition={{ duration: 0.5, repeat: timeLeft <= 5 ? Infinity : 0 }}
              >
                <div className={`w-32 h-32 rounded-full flex items-center justify-center text-5xl font-black transition-all duration-300 ${
                  timeLeft <= 5 ? 'bg-red-500 text-white animate-pulse' : 
                  timeLeft <= 10 ? 'bg-orange-500 text-white' :
                  'bg-gray-200 text-gray-700'
                }`}>
                  {timeLeft}
                </div>
              </motion.div>
            )}

            <motion.h2 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-5xl font-black text-gray-900 leading-tight px-4"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
            >
              {currentQuestion.question}
            </motion.h2>

            <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-200">
              <motion.div
                className="h-full bg-purple-600"
                initial={{ width: '0%' }}
                animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-8">
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
                  borderStyle = 'ring-8 ring-green-400';
                } else if (isWrong) {
                  buttonStyle = { backgroundColor: '#EF4444' };
                  borderStyle = 'ring-8 ring-red-400';
                } else {
                  buttonStyle = { backgroundColor: colorScheme.bg, opacity: 0.6 };
                }
              } else {
                buttonStyle = { 
                  backgroundColor: isSelected ? colorScheme.hover : colorScheme.bg 
                };
                if (isSelected) {
                  borderStyle = 'ring-8 ring-white scale-105';
                }
              }

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
                    relative overflow-hidden rounded-3xl p-12
                    transition-all duration-300 shadow-2xl
                    ${borderStyle}
                    ${(answered || isAdmin) ? 'cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="absolute top-8 left-8">
                    <ShapeIcon />
                  </div>

                  <div className="text-left pl-24">
                    <span className="text-4xl font-bold text-white">
                      {option}
                    </span>
                  </div>

                  <AnimatePresence>
                    {showAnswerReveal && (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", delay: 0.2 }}
                        className="absolute top-8 right-8"
                      >
                        {isCorrect && (
                          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                            <Check className="w-10 h-10 text-green-500" strokeWidth={4} />
                          </div>
                        )}
                        {isWrong && (
                          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                            <X className="w-10 h-10 text-red-500" strokeWidth={4} />
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
                className="flex justify-center mt-12"
              >
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    onClick={handleSubmit}
                    size="lg"
                    className="bg-white text-purple-600 hover:bg-gray-100 font-black text-3xl px-16 py-8 rounded-full shadow-2xl"
                    style={{ fontFamily: 'Fredoka, sans-serif' }}
                  >
                    <Zap className="w-8 h-8 mr-3" />
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
              className="text-center mt-12"
            >
              <motion.p
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-white text-2xl font-semibold"
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
                className="flex justify-center gap-6 mt-12"
              >
                {!showAnswerReveal && (
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      onClick={handleShowAnswer}
                      size="lg"
                      className="bg-orange-500 hover:bg-orange-600 text-white font-black text-2xl px-12 py-8 rounded-full shadow-2xl"
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
                  >
                    <Button
                      onClick={handleShowLeaderboard}
                      size="lg"
                      className="bg-blue-500 hover:bg-blue-600 text-white font-black text-2xl px-12 py-8 rounded-full shadow-2xl flex items-center gap-4"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      <BarChart3 className="w-8 h-8" />
                      Show Leaderboard
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default QuizPlay;
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import {
  Users, Play, Trophy, Copy, QrCode, Share2,
  LogOut, Sparkles, Crown, Star, Clock, CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import DicebearAvatar from '@/components/ui/avatar/DicebearAvatar';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;

const AdminControl = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  
  const [quiz, setQuiz] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  
  // FIXED: Proper state tracking
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [quizState, setQuizState] = useState('lobby');
  const [answeredCount, setAnsweredCount] = useState(0);
  
  // Timer tracking
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const timerRef = useRef(null);
  
  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${window.location.origin}/join?code=${code}`;
  const joinUrl = `${window.location.origin}/join?code=${code}`;

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code);
    toast.success('📋 Game PIN copied!');
    confetti({ particleCount: 50, spread: 50, origin: { y: 0.6 } });
  }, [code]);

  const shareQuiz = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: quiz?.title,
          text: `Join my quiz! Game PIN: ${code}`,
          url: joinUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard.writeText(joinUrl);
          toast.success('Join link copied!');
        }
      }
    } else {
      navigator.clipboard.writeText(joinUrl);
      toast.success('Join link copied!');
    }
  }, [quiz, code, joinUrl]);

  const fetchQuizDetails = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/admin/quiz/${code}`);
      if (mountedRef.current) {
        setQuiz(response.data);
        setTotalQuestions(response.data.questions?.length || 0);
        setLoading(false);
      }
    } catch (error) {
      console.error('Fetch quiz error:', error);
      toast.error('Failed to load quiz');
      navigate('/admin');
    }
  }, [code, navigate]);

  const fetchParticipants = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/admin/quiz/${code}/participants`);
      if (mountedRef.current && response.data.participants) {
        setParticipants(response.data.participants);
      }
    } catch (error) {
      console.error('Fetch participants error:', error);
    }
  }, [code]);

  // Timer management
  const startTimer = useCallback((questionIndex) => {
    if (!quiz?.questions?.[questionIndex]) return;
    
    const timeLimit = quiz.questions[questionIndex].timeLimit || 20;
    console.log(`⏱️ Admin timer started: ${timeLimit}s for Q${questionIndex}`);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    setTimeLeft(timeLimit);
    setTimerActive(true);
    
    let currentTime = timeLimit;
    timerRef.current = setInterval(() => {
      currentTime -= 1;
      setTimeLeft(currentTime);
      
      if (currentTime <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setTimerActive(false);
        
        // FIXED: Auto-reveal answers when time is up
        console.log('⏰ Time up - auto-revealing answers');
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'show_answer' }));
        }
      }
    }, 1000);
  }, [quiz]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimerActive(false);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const socket = new WebSocket(`${wsUrl}/ws/${code}`);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('✓ Admin WebSocket connected');
      if (mountedRef.current) {
        setWsConnected(true);
        socket.send(JSON.stringify({ type: 'admin_joined', code }));
      }
    };

    socket.onmessage = (event) => {
      if (!mountedRef.current) return;
      
      const data = JSON.parse(event.data);
      console.log('Admin WS message:', data);

      switch (data.type) {
        case 'participant_joined':
          setParticipants(prev => {
            const exists = prev.find(p => p.id === data.participant.id);
            if (!exists) {
              confetti({ particleCount: 30, spread: 40, origin: { x: Math.random(), y: 0.6 } });
              toast.success(`${data.participant.name} joined! 🎉`);
              return [...prev, data.participant];
            }
            return prev;
          });
          break;

        case 'all_participants':
          setParticipants(data.participants || []);
          if (data.current_question !== undefined) {
            setCurrentQuestionIndex(data.current_question);
          }
          if (data.total_questions !== undefined) {
            setTotalQuestions(data.total_questions);
          }
          if (data.quiz_state) {
            setQuizState(data.quiz_state);
          }
          break;

        case 'avatar_updated':
          setParticipants(prev => prev.map(p => 
            p.id === data.participantId ? { ...p, avatarSeed: data.avatarSeed } : p
          ));
          break;

        case 'answer_count':
          setAnsweredCount(data.answeredCount || 0);
          break;

        case 'sync_state':
          // FIXED: Update admin state from server
          if (data.current_question !== undefined) {
            setCurrentQuestionIndex(data.current_question);
          }
          if (data.quiz_state) {
            setQuizState(data.quiz_state);
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
      console.error('Admin WebSocket error:', error);
      if (mountedRef.current) {
        setWsConnected(false);
      }
    };

    socket.onclose = () => {
      console.log('Admin WebSocket disconnected');
      if (mountedRef.current) {
        setWsConnected(false);
        stopTimer();
        wsRef.current = null;
        setTimeout(() => {
          if (mountedRef.current && !wsRef.current) {
            connectWebSocket();
          }
        }, 3000);
      }
    };
  }, [code, stopTimer]);

  const handleStartQuiz = useCallback(() => {
    if (participants.length === 0) {
      toast.error('⚠️ No participants yet!');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'quiz_starting' }));
      setCountdown(5);
      setCurrentQuestionIndex(0); // FIXED: Reset to 0
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } else {
      toast.error('❌ Connection lost');
    }
  }, [participants.length]);

  const handleEndQuiz = useCallback(async () => {
    try {
      await axios.patch(`${API}/admin/quiz/${code}/status?status=ended`);
      toast.success('Quiz ended');
      navigate('/admin');
    } catch (error) {
      console.error('Error ending quiz:', error);
      toast.error('Failed to end quiz');
    }
  }, [code, navigate]);

  useEffect(() => {
    if (countdown === null || countdown === 0) return;

    const timer = setTimeout(() => {
      if (countdown === 1) {
        // Start the timer when quiz begins
        setQuizState('question');
        startTimer(0);
        navigate(`/quiz/${code}`);
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, code, navigate, startTimer]);

  useEffect(() => {
    mountedRef.current = true;
    localStorage.setItem('isAdmin', 'true');
    
    fetchQuizDetails();
    fetchParticipants();
    connectWebSocket();

    const pollInterval = setInterval(fetchParticipants, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(pollInterval);
      stopTimer();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [fetchQuizDetails, fetchParticipants, connectWebSocket, stopTimer]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-20 h-20 border-8 border-white border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-900 relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
              scale: Math.random() * 0.5 + 0.5,
              opacity: Math.random() * 0.3
            }}
            animate={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            transition={{
              duration: Math.random() * 20 + 10,
              repeat: Infinity,
              repeatType: "reverse"
            }}
          >
            <div className="w-4 h-4 bg-white rounded-full blur-sm" style={{ opacity: Math.random() * 0.3 }} />
          </motion.div>
        ))}
      </div>

      {/* Header */}
      <div className="relative z-10 p-6 flex justify-between items-center">
        <motion.div
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex items-center gap-3"
        >
          <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center">
            <Trophy className="w-8 h-8 text-yellow-300" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Admin Control Panel</h3>
            <div className="flex items-center gap-2">
              <p className="text-white/70 text-sm">Game PIN: {code}</p>
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-red-400'}`}
              />
            </div>
            {/* FIXED: Display current question properly */}
            {quizState !== 'lobby' && totalQuestions > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <Clock className="w-4 h-4 text-yellow-300" />
                <p className="text-yellow-300 text-sm font-bold">
                  Question {currentQuestionIndex + 1} of {totalQuestions}
                </p>
                {timerActive && (
                  <Badge className="bg-orange-500 text-white ml-2">
                    {timeLeft}s
                  </Badge>
                )}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex items-center gap-2"
        >
          {quizState !== 'lobby' && (
            <div className="text-white text-sm font-semibold flex items-center gap-2 bg-white/20 rounded-full px-4 py-2">
              <CheckCircle className="w-5 h-5 text-green-300" />
              <span>{answeredCount} / {participants.length} answered</span>
            </div>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            onClick={handleEndQuiz}
            className="bg-red-500/80 hover:bg-red-600 text-white rounded-full h-12 w-12"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          
          {/* Quiz Title */}
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-center mb-6"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-block mb-4"
            >
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-2xl">
                <Sparkles className="w-14 h-14 text-purple-600" />
              </div>
            </motion.div>

            <h1
              className="text-7xl font-black text-white mb-4 drop-shadow-lg"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
            >
              {quiz?.title}
            </h1>

            {quiz?.description && (
              <p className="text-2xl text-white/90 mb-6">{quiz.description}</p>
            )}

            {/* Game PIN Card */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-3xl shadow-2xl p-8 max-w-2xl mx-auto mb-8"
            >
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-purple-600 uppercase tracking-wider mb-2">Game PIN</p>
                  <div className="flex items-center gap-4">
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      className="text-6xl font-black text-purple-900 tracking-wider cursor-pointer select-all"
                      onClick={copyCode}
                    >
                      {code}
                    </motion.div>
                    <Button variant="ghost" size="icon" onClick={copyCode} className="h-12 w-12">
                      <Copy className="w-6 h-6" />
                    </Button>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button variant="outline" size="sm" onClick={shareQuiz}>
                      <Share2 className="w-4 h-4 mr-2" />Share
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowQR(!showQR)}>
                      <QrCode className="w-4 h-4 mr-2" />QR Code
                    </Button>
                  </div>
                </div>

                <AnimatePresence>
                  {showQR && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="bg-white p-4 rounded-2xl shadow-xl"
                    >
                      <img src={qrCodeUrl} alt="QR Code" className="w-40 h-40 rounded-lg" />
                      <p className="text-xs text-center text-gray-600 mt-2">Scan to join</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Quiz Stats */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-4 gap-4 max-w-3xl mx-auto"
            >
              <Card className="bg-white/10 backdrop-blur-md border-white/20 p-4">
                <div className="text-4xl font-black text-white">{totalQuestions}</div>
                <div className="text-sm font-semibold text-white/80 mt-1">Questions</div>
              </Card>
              <Card className="bg-white/10 backdrop-blur-md border-white/20 p-4">
                <div className="text-4xl font-black text-green-300">{participants.length}</div>
                <div className="text-sm font-semibold text-white/80 mt-1">Players</div>
              </Card>
              <Card className="bg-white/10 backdrop-blur-md border-white/20 p-4">
                <div className="text-4xl font-black text-orange-300">{quiz?.duration || 0}</div>
                <div className="text-sm font-semibold text-white/80 mt-1">Minutes</div>
              </Card>
              <Card className="bg-white/10 backdrop-blur-md border-white/20 p-4">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-4 h-4 bg-green-400 rounded-full mx-auto mb-1"
                />
                <div className="text-sm font-semibold text-white/80">Live</div>
              </Card>
            </motion.div>
          </motion.div>

          {/* Participants Section */}
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl p-8 border-2 border-white/20"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-white" />
                <h2 className="text-3xl font-black text-white" style={{ fontFamily: 'Fredoka, sans-serif' }}>
                  Players in Lobby
                </h2>
              </div>

              <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                <Badge className="bg-green-500 text-white px-4 py-2 text-lg font-bold">
                  {participants.length} Online
                </Badge>
              </motion.div>
            </div>

            {/* Participants Grid */}
            {participants.length === 0 ? (
              <div className="text-center py-20">
                <motion.div
                  animate={{ y: [0, -20, 0], rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 3, repeat: Infinity }}
                >
                  <Users className="w-32 h-32 text-white/30 mx-auto mb-6" />
                </motion.div>
                <h3 className="text-3xl font-bold text-white/60 mb-2">Waiting for players...</h3>
                <p className="text-xl text-white/40">Share the game PIN to get started!</p>
              </div>
            ) : (
              <div className="grid grid-cols-6 gap-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                <AnimatePresence>
                  {participants.map((participant, index) => (
                    <motion.div
                      key={participant.id}
                      initial={{ scale: 0, rotate: -180, opacity: 0 }}
                      animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      exit={{ scale: 0, rotate: 180, opacity: 0 }}
                      transition={{ type: "spring", delay: index * 0.05, duration: 0.6 }}
                      className="relative"
                    >
                      <Card className="bg-white p-4 shadow-lg hover:shadow-xl transition-shadow">
                        {index === 0 && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute -top-2 -right-2 z-10"
                          >
                            <div className="bg-yellow-400 text-purple-900 rounded-full p-2 shadow-lg">
                              <Crown className="w-4 h-4" />
                            </div>
                          </motion.div>
                        )}

                        <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="mb-3">
                          <DicebearAvatar 
                            seed={participant.avatarSeed}
                            size="lg"
                            className="mx-auto shadow-lg"
                          />
                        </motion.div>

                        <p className="font-bold text-gray-900 text-center truncate text-sm">
                          {participant.name}
                        </p>

                        <div className="flex items-center justify-center gap-1 mt-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-xs text-gray-600">Ready</span>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>

          {/* Control Buttons */}
          {countdown === null && quizState === 'lobby' && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-8 text-center"
            >
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  onClick={handleStartQuiz}
                  disabled={participants.length === 0}
                  size="lg"
                  className="bg-white text-purple-600 hover:bg-gray-100 font-black text-3xl px-16 py-8 rounded-full shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontFamily: 'Fredoka, sans-serif' }}
                >
                  <Play className="w-10 h-10 mr-4" />
                  Start Quiz
                </Button>
              </motion.div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Countdown Overlay */}
      <AnimatePresence>
        {countdown !== null && countdown > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <motion.div
              key={countdown}
              initial={{ scale: 0, opacity: 0, rotate: -180 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0, opacity: 0, rotate: 180 }}
              transition={{ type: "spring", duration: 0.6 }}
              className="text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1], rotate: [0, 360] }}
                transition={{ duration: 1 }}
                className="text-[250px] font-black text-white mb-8 leading-none"
                style={{ fontFamily: 'Fredoka, sans-serif' }}
              >
                {countdown}
              </motion.div>
              <motion.p
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                className="text-5xl font-bold text-white/90"
              >
                Get Ready!
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.5);
        }
      `}</style>
    </div>
  );
};

export default AdminControl;
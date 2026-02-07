import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Crown, Star, ArrowRight, TrendingUp, Medal, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';
import DicebearAvatar from '@/components/ui/avatar/DicebearAvatar';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;

const Leaderboard = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const questionIndex = parseInt(searchParams.get('question') || '0');
  
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [quiz, setQuiz] = useState(null);
  
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const participantId = localStorage.getItem('participantId');
  const isFinalLeaderboard = questionIndex >= 0 && totalQuestions > 0 && (questionIndex + 1) >= totalQuestions;

  useEffect(() => {
    fetchResults();
    
    setTimeout(() => {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }, 500);
  }, []);

  const fetchResults = async () => {
    try {
      const [leaderboardRes, quizRes] = await Promise.all([
        axios.get(`${API}/leaderboard/${code}`),
        axios.get(`${API}/admin/quiz/${code}`)
      ]);
      
      setLeaderboard(leaderboardRes.data);
      setQuiz(quizRes.data);
      setTotalQuestions(quizRes.data.questions?.length || 0);
      setLoading(false);
    } catch (error) {
      console.error('Fetch results error:', error);
      toast.error('Failed to load leaderboard');
      setLoading(false);
    }
  };

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const socket = new WebSocket(`${wsUrl}/ws/${code}`);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('Leaderboard WebSocket connected');
      if (isAdmin) {
        socket.send(JSON.stringify({ type: 'admin_joined', code }));
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Leaderboard received:', data);
      
      if (data.type === 'next_question') {
        const nextIdx = data.current_question || (questionIndex + 1);
        if (nextIdx < totalQuestions) {
          navigate(`/quiz/${code}`);
        }
      } else if (data.type === 'show_podium') {
        navigate(`/podium/${code}`);
      } else if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    };

    socket.onerror = (error) => {
      console.error('Leaderboard WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('Leaderboard WebSocket closed');
      wsRef.current = null;
      setTimeout(connectWebSocket, 3000);
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [code, navigate, questionIndex, totalQuestions, isAdmin]);

  useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  const handleNext = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (isFinalLeaderboard) {
        wsRef.current.send(JSON.stringify({ type: 'next_question' }));
      } else {
        wsRef.current.send(JSON.stringify({ type: 'next_question' }));
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-8 border-yellow-400 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full"
            style={{
              background: ['#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4', '#95E1D3'][Math.floor(Math.random() * 5)]
            }}
            initial={{ 
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920),
              y: -20,
              scale: Math.random() * 0.5 + 0.5
            }}
            animate={{ 
              y: (typeof window !== 'undefined' ? window.innerHeight : 1080) + 20,
              rotate: Math.random() * 360
            }}
            transition={{ 
              duration: Math.random() * 5 + 5,
              repeat: Infinity,
              delay: Math.random() * 5,
              ease: "linear"
            }}
          />
        ))}
      </div>

      <div className="relative z-10 min-h-screen p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", duration: 1 }}
            className="text-center mb-8"
          >
            <motion.div
              animate={{ 
                rotate: [0, -10, 10, -10, 0],
                scale: [1, 1.2, 1]
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-block mb-4"
            >
              <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-2xl">
                <BarChart3 className="w-12 h-12 md:w-14 md:h-14 text-white" />
              </div>
            </motion.div>
            
            <motion.h1 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.3 }}
              className="text-5xl md:text-7xl font-black text-white mb-3 drop-shadow-lg"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              {isFinalLeaderboard ? 'Final Standings!' : 'Leaderboard'}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-xl md:text-2xl text-white/90 font-semibold"
            >
              {isFinalLeaderboard 
                ? `Quiz Complete! ${leaderboard.length} players competed`
                : `After Question ${questionIndex + 1} of ${totalQuestions}`
              }
            </motion.p>
          </motion.div>

          {/* FIXED: Leaderboard with Position Numbers */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl p-4 md:p-8 border-2 border-white/20 mb-8"
          >
            <div className="space-y-3">
              <AnimatePresence>
                {leaderboard.map((entry, index) => {
                  const isCurrentPlayer = entry.participantId === participantId;
                  const isTop3 = index < 3;
                  
                  return (
                    <motion.div
                      key={entry.participantId}
                      initial={{ x: -100, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: index * 0.05, type: "spring" }}
                      className={`
                        relative overflow-hidden rounded-2xl p-4 md:p-6 shadow-lg
                        transition-all duration-300 hover:scale-[1.02]
                        ${isCurrentPlayer 
                          ? 'bg-gradient-to-r from-yellow-400 to-orange-500 ring-4 ring-yellow-300 scale-105' 
                          : isTop3
                          ? 'bg-gradient-to-r from-purple-500 to-pink-500'
                          : 'bg-white/20 backdrop-blur-sm'
                        }
                      `}
                    >
                      {/* CRITICAL FIX: Position Number Badge */}
                      <div className="absolute -left-2 -top-2">
                        <div className={`
                          w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center font-black text-xl md:text-2xl
                          ${isTop3 
                            ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white shadow-xl' 
                            : 'bg-white text-gray-700'
                          }
                        `}>
                          {index === 0 && <Crown className="w-6 h-6 md:w-7 md:h-7" />}
                          {index === 1 && <Medal className="w-6 h-6 md:w-7 md:h-7" />}
                          {index === 2 && <Star className="w-6 h-6 md:w-7 md:h-7" />}
                          {index > 2 && (index + 1)}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 md:gap-6 pl-10 md:pl-12">
                        <motion.div
                          whileHover={{ scale: 1.1, rotate: 5 }}
                          className="flex-shrink-0"
                        >
                          <DicebearAvatar 
                            seed={entry.avatarSeed}
                            size="lg"
                            className="ring-4 ring-white/50 shadow-xl"
                          />
                        </motion.div>

                        <div className="flex-1 min-w-0">
                          <h3 className={`
                            text-xl md:text-2xl font-bold truncate
                            ${isCurrentPlayer ? 'text-white' : 'text-white'}
                          `}>
                            {entry.name}
                            {isCurrentPlayer && ' (You)'}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <TrendingUp className="w-4 h-4 text-white/80" />
                            <span className="text-sm md:text-base text-white/80 font-semibold">
                              {entry.totalTime.toFixed(1)}s
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 md:px-6 py-2 md:py-3 flex-shrink-0">
                          <Star className="w-5 h-5 md:w-6 md:h-6 text-yellow-300" />
                          <span className="text-2xl md:text-3xl font-black text-white">
                            {entry.score}
                          </span>
                        </div>
                      </div>

                      {isCurrentPlayer && (
                        <motion.div
                          className="absolute inset-0 bg-white/20"
                          animate={{ opacity: [0.2, 0, 0.2] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        />
                      )}

                      {index === 0 && (
                        <motion.div
                          animate={{ 
                            y: [0, -5, 0],
                            rotate: [0, 5, -5, 0]
                          }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="absolute top-2 right-2"
                        >
                          <Trophy className="w-6 h-6 md:w-8 md:h-8 text-yellow-300" />
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>

          {isAdmin && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-center"
            >
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  onClick={handleNext}
                  size="lg"
                  className="bg-white text-purple-600 hover:bg-gray-100 font-black text-2xl md:text-3xl px-12 md:px-16 py-6 md:py-8 rounded-full shadow-2xl flex items-center gap-4 mx-auto"
                  style={{ fontFamily: 'Fredoka, sans-serif' }}
                >
                  {isFinalLeaderboard ? (
                    <>
                      <Trophy className="w-8 h-8 md:w-10 md:h-10" />
                      Show Winners
                    </>
                  ) : (
                    <>
                      Next Question
                      <ArrowRight className="w-8 h-8 md:w-10 md:h-10" />
                    </>
                  )}
                </Button>
              </motion.div>
            </motion.div>
          )}

          {!isAdmin && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-center"
            >
              <motion.p
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-white text-xl md:text-2xl font-semibold"
              >
                {isFinalLeaderboard 
                  ? '🏆 Waiting for final results...'
                  : '⏳ Waiting for next question...'
                }
              </motion.p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;
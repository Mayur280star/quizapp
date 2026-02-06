import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Crown, Star, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;

const Leaderboard = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const questionIndex = searchParams.get('question');
  
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [quiz, setQuiz] = useState(null);
  
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const isFinalLeaderboard = questionIndex && totalQuestions > 0 && (parseInt(questionIndex) + 1) >= totalQuestions;

  useEffect(() => {
    fetchResults();
    
    setTimeout(() => {
      setShowCelebration(true);
      triggerConfetti();
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

  const triggerConfetti = () => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min, max) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      
      confetti(Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      }));
      confetti(Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      }));
    }, 250);
  };

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
      
      if (data.type === 'next_question') {
        const nextIdx = parseInt(questionIndex || 0) + 1;
        if (nextIdx < totalQuestions) {
          navigate(`/quiz/${code}`);
        } else {
          navigate(`/podium/${code}`);
        }
      } else if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    };

    socket.onerror = (error) => {
      console.error('Leaderboard WebSocket error:', error);
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
  }, [code, navigate, questionIndex, totalQuestions, isAdmin]);

  useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  const handleNext = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'next_question' }));
    }
  };

  const getPodiumHeight = (rank) => {
    switch (rank) {
      case 1: return 'h-64';
      case 2: return 'h-48';
      case 3: return 'h-40';
      default: return 'h-32';
    }
  };

  const getPodiumColor = (rank) => {
    switch (rank) {
      case 1: return 'from-yellow-400 to-orange-600';
      case 2: return 'from-gray-300 to-gray-500';
      case 3: return 'from-orange-400 to-orange-600';
      default: return 'from-gray-400 to-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-8 border-yellow-400 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  const topThree = leaderboard.slice(0, 3);
  const others = leaderboard.slice(3);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(100)].map((_, i) => (
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

      <div className="relative z-10 min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", duration: 1 }}
            className="text-center mb-12"
          >
            <motion.div
              animate={{ 
                rotate: [0, -10, 10, -10, 0],
                scale: [1, 1.2, 1]
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-block mb-6"
            >
              <div className="w-32 h-32 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-2xl">
                <Trophy className="w-20 h-20 text-white" />
              </div>
            </motion.div>
            
            <motion.h1 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.3 }}
              className="text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-400 to-orange-500 mb-4 drop-shadow-lg"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              Leaderboard
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-3xl text-white/90 font-semibold"
            >
              {isFinalLeaderboard ? 'Final Results!' : `After Question ${parseInt(questionIndex || 0) + 1} of ${totalQuestions}`}
            </motion.p>
          </motion.div>

          <AnimatePresence>
            {showCelebration && topThree.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-end justify-center gap-8 mb-12 px-4"
              >
                {topThree[1] && (
                  <motion.div
                    initial={{ y: 200, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3, type: "spring" }}
                    className="flex flex-col items-center w-72"
                  >
                    <motion.div
                      animate={{ y: [0, -10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="mb-6"
                    >
                      <div className="w-28 h-28 bg-gradient-to-br from-gray-300 to-gray-500 rounded-full flex items-center justify-center shadow-2xl ring-4 ring-white/30">
                        <span className="text-5xl font-black text-white">
                          {topThree[1].name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </motion.div>

                    <div className={`w-full bg-gradient-to-b ${getPodiumColor(2)} rounded-t-3xl p-8 shadow-2xl ${getPodiumHeight(2)}`}>
                      <div className="text-center">
                        <div className="text-9xl font-black text-white mb-3">2</div>
                        <h3 className="text-3xl font-bold text-white mb-3 truncate">
                          {topThree[1].name}
                        </h3>
                        <div className="bg-white/20 rounded-full px-6 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <Star className="w-6 h-6 text-yellow-200" />
                            <span className="text-2xl font-black text-white">
                              {topThree[1].score}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {topThree[0] && (
                  <motion.div
                    initial={{ y: 200, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1, type: "spring" }}
                    className="flex flex-col items-center w-80"
                  >
                    <motion.div
                      animate={{ 
                        y: [0, -20, 0],
                        rotate: [0, 5, -5, 0]
                      }}
                      transition={{ duration: 3, repeat: Infinity }}
                      className="mb-6 relative"
                    >
                      <motion.div
                        animate={{ 
                          scale: [1, 1.3, 1],
                          opacity: [0.3, 0.6, 0.3]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute -inset-8 bg-gradient-to-r from-yellow-300 via-yellow-400 to-orange-400 rounded-full blur-2xl"
                      />
                      
                      <div className="relative w-36 h-36 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-2xl ring-8 ring-yellow-300/50">
                        <span className="text-7xl font-black text-white">
                          {topThree[0].name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      
                      <motion.div
                        animate={{ 
                          rotate: [0, -10, 10, -10, 0],
                          y: [0, -5, 0]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute -top-12 left-1/2 transform -translate-x-1/2"
                      >
                        <Crown className="w-20 h-20 text-yellow-300 drop-shadow-2xl" />
                      </motion.div>

                      {[...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          initial={{ scale: 0, opacity: 1 }}
                          animate={{
                            scale: [0, 1, 0],
                            opacity: [1, 1, 0],
                            x: Math.cos(i * 45 * Math.PI / 180) * 60,
                            y: Math.sin(i * 45 * Math.PI / 180) * 60
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            delay: i * 0.1
                          }}
                          className="absolute top-1/2 left-1/2"
                        >
                          <Star className="w-6 h-6 text-yellow-300" />
                        </motion.div>
                      ))}
                    </motion.div>

                    <div className={`w-full bg-gradient-to-b ${getPodiumColor(1)} rounded-t-3xl p-8 shadow-2xl ${getPodiumHeight(1)} relative overflow-hidden`}>
                      <motion.div
                        animate={{ x: ['-100%', '200%'] }}
                        transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                        style={{ width: '50%' }}
                      />
                      
                      <div className="text-center relative z-10">
                        <motion.div
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                          className="text-[10rem] font-black text-white mb-3 drop-shadow-2xl leading-none"
                        >
                          1
                        </motion.div>
                        <h3 className="text-4xl font-bold text-white mb-4 truncate drop-shadow-lg">
                          {topThree[0].name}
                        </h3>
                        <div className="bg-white/40 backdrop-blur-sm rounded-full px-8 py-4">
                          <div className="flex items-center justify-center gap-3">
                            <Star className="w-8 h-8 text-yellow-100" />
                            <span className="text-4xl font-black text-white">
                              {topThree[0].score}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {topThree[2] && (
                  <motion.div
                    initial={{ y: 200, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5, type: "spring" }}
                  className="flex flex-col items-center w-72"
              >
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="mb-6"
                >
                  <div className="w-28 h-28 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center shadow-2xl ring-4 ring-white/30">
                    <span className="text-5xl font-black text-white">
                      {topThree[2].name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </motion.div>

                <div className={`w-full bg-gradient-to-b ${getPodiumColor(3)} rounded-t-3xl p-8 shadow-2xl ${getPodiumHeight(3)}`}>
                  <div className="text-center">
                    <div className="text-9xl font-black text-white mb-3">3</div>
                    <h3 className="text-3xl font-bold text-white mb-3 truncate">
                      {topThree[2].name}
                    </h3>
                    <div className="bg-white/20 rounded-full px-6 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <Star className="w-6 h-6 text-yellow-200" />
                        <span className="text-2xl font-black text-white">
                          {topThree[2].score}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {others.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="space-y-4 mb-12 max-w-4xl mx-auto"
        >
          {others.map((entry, index) => (
            <motion.div
              key={entry.participantId}
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.8 + index * 0.05 }}
              className="bg-white/10 backdrop-blur-md rounded-2xl p-6 shadow-xl hover:bg-white/20 transition-all"
            >
              <div className="flex items-center gap-6">
                <div className="w-16 flex-shrink-0">
                  <div className="w-14 h-14 rounded-full bg-purple-500 flex items-center justify-center">
                    <span className="text-white font-bold text-2xl">{entry.rank}</span>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-white truncate">
                    {entry.name}
                  </h3>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Star className="w-6 h-6 text-yellow-400" />
                    <span className="text-3xl font-black text-yellow-400">
                      {entry.score}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {isAdmin && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center"
        >
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              onClick={handleNext}
              size="lg"
              className="bg-white text-purple-600 hover:bg-gray-100 font-black text-3xl px-16 py-8 rounded-full shadow-2xl flex items-center gap-4 mx-auto"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
            >
              {isFinalLeaderboard ? (
                <>
                  <Trophy className="w-10 h-10" />
                  Show Winners
                </>
              ) : (
                <>
                  Next Question
                  <ArrowRight className="w-10 h-10" />
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
          transition={{ delay: 1 }}
          className="text-center"
        >
          <motion.p
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-white/80 text-2xl font-semibold"
          >
            ⏳ Waiting for host to continue...
          </motion.p>
        </motion.div>
      )}
    </div>
  </div>
</div>
);
};
export default Leaderboard;
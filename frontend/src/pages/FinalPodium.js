import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Crown, Medal, Star, Home, BarChart3, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FinalPodium = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  
  const [winners, setWinners] = useState([]);
  const [quizStats, setQuizStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSpotlight, setShowSpotlight] = useState(true);
  const [showStats, setShowStats] = useState(false);
  
  const isAdmin = localStorage.getItem('isAdmin') === 'true';

  useEffect(() => {
    fetchResults();
    
    // Massive celebration
    setTimeout(() => triggerMassiveConfetti(), 1000);
  }, []);

  const fetchResults = async () => {
    try {
      const response = await axios.get(`${API}/quiz/${code}/final-results`);
      setWinners(response.data.winners);
      setQuizStats(response.data.stats);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching results:', error);
      toast.error('Failed to load results');
      setLoading(false);
    }
  };

  const triggerMassiveConfetti = () => {
    const duration = 5 * 1000;
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

  const handleEndQuiz = async () => {
    try {
      await axios.post(`${API}/quiz/${code}/end`);
      toast.success('Quiz ended successfully');
      navigate('/admin');
    } catch (error) {
      console.error('Error ending quiz:', error);
      toast.error('Failed to end quiz');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-20 h-20 border-8 border-yellow-400 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 relative overflow-hidden">
      {/* Animated Background */}
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

      {/* Main Content */}
      <div className="relative z-10 min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
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
              Game Over!
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-3xl text-white/90 font-semibold"
            >
              Final Results
            </motion.p>
          </motion.div>

          {/* Winner Spotlight */}
          <AnimatePresence>
            {showSpotlight && winners.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="mb-12"
              >
                {/* Winner Podium */}
                <div className="flex items-end justify-center gap-8 mb-12">
                  {/* 2nd Place */}
                  {winners[1] && (
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
                            {winners[1].name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </motion.div>

                      <div className="w-full bg-gradient-to-b from-gray-300 to-gray-500 rounded-t-3xl p-8 shadow-2xl h-64">
                        <div className="text-center">
                          <div className="text-9xl font-black text-white mb-3">2</div>
                          <h3 className="text-3xl font-bold text-white mb-3 truncate">
                            {winners[1].name}
                          </h3>
                          <div className="bg-white/20 rounded-full px-6 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <Star className="w-6 h-6 text-yellow-200" />
                              <span className="text-2xl font-black text-white">
                                {winners[1].score}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 1st Place - WINNER! */}
                  {winners[0] && (
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
                        {/* Spotlight effect */}
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
                            {winners[0].name.charAt(0).toUpperCase()}
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

                        {/* Sparkles */}
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

                      <div className="w-full bg-gradient-to-b from-yellow-400 to-orange-600 rounded-t-3xl p-8 shadow-2xl h-80 relative overflow-hidden">
                        {/* Shine effect */}
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
                            {winners[0].name}
                          </h3>
                          <div className="bg-white/40 backdrop-blur-sm rounded-full px-8 py-4 mb-3">
                            <div className="flex items-center justify-center gap-3">
                              <Star className="w-8 h-8 text-yellow-100" />
                              <span className="text-4xl font-black text-white">
                                {winners[0].score}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 3rd Place */}
                  {winners[2] && (
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
                            {winners[2].name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </motion.div>

                      <div className="w-full bg-gradient-to-b from-orange-400 to-orange-600 rounded-t-3xl p-8 shadow-2xl h-56">
                        <div className="text-center">
                          <div className="text-9xl font-black text-white mb-3">3</div>
                          <h3 className="text-3xl font-bold text-white mb-3 truncate">
                            {winners[2].name}
                          </h3>
                          <div className="bg-white/20 rounded-full px-6 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <Star className="w-6 h-6 text-yellow-200" />
                              <span className="text-2xl font-black text-white">
                                {winners[2].score}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="flex flex-col sm:flex-row gap-6 justify-center items-center"
          >
            {isAdmin && (
              <>
                <Button
                  onClick={() => setShowStats(!showStats)}
                  size="lg"
                  className="bg-blue-500 hover:bg-blue-600 text-white font-black text-2xl px-12 py-8 rounded-full shadow-2xl flex items-center gap-4"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  <BarChart3 className="w-8 h-8" />
                  {showStats ? 'Hide Stats' : 'Show Stats'}
                </Button>

                <Button
                  onClick={handleEndQuiz}
                  size="lg"
                  className="bg-red-500 hover:bg-red-600 text-white font-black text-2xl px-12 py-8 rounded-full shadow-2xl flex items-center gap-4"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  <X className="w-8 h-8" />
                  End Quiz
                </Button>
              </>
            )}

            <Button
              onClick={() => navigate('/')}
              size="lg"
              className="bg-white text-purple-600 hover:bg-gray-100 font-black text-2xl px-12 py-8 rounded-full shadow-2xl flex items-center gap-4"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              <Home className="w-8 h-8" />
              Back to Home
            </Button>
          </motion.div>

          {/* Quiz Stats Panel */}
          <AnimatePresence>
            {showStats && quizStats && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
                className="mt-12 bg-white/10 backdrop-blur-md rounded-3xl p-8 shadow-2xl"
              >
                <h2 className="text-4xl font-black text-white mb-8 text-center"
                    style={{ fontFamily: "'Fredoka', sans-serif" }}>
                  Quiz Statistics
                </h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="bg-white/10 rounded-2xl p-6 text-center">
                    <div className="text-5xl font-black text-yellow-400 mb-2">
                      {quizStats.totalParticipants}
                    </div>
                    <div className="text-white/80 text-lg">Total Players</div>
                  </div>

                  <div className="bg-white/10 rounded-2xl p-6 text-center">
                    <div className="text-5xl font-black text-green-400 mb-2">
                      {quizStats.totalQuestions}
                    </div>
                    <div className="text-white/80 text-lg">Questions</div>
                  </div>

                  <div className="bg-white/10 rounded-2xl p-6 text-center">
                    <div className="text-5xl font-black text-blue-400 mb-2">
                      {quizStats.averageScore}
                    </div>
                    <div className="text-white/80 text-lg">Avg Score</div>
                  </div>

                  <div className="bg-white/10 rounded-2xl p-6 text-center">
                    <div className="text-5xl font-black text-purple-400 mb-2">
                      {quizStats.completionRate}%
                    </div>
                    <div className="text-white/80 text-lg">Completion</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default FinalPodium;
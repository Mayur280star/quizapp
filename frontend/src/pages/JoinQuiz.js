// frontend/src/pages/JoinQuiz.js
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { LogIn, ArrowLeft, Sparkles, Shuffle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import DicebearAvatar from '@/components/ui/avatar/DicebearAvatar';
import { 
  generateRandomSeed, 
  saveAvatarSeed, 
  getStoredAvatarSeed 
} from '@/utils/avatar';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;

const JoinQuiz = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const codeFromUrl = searchParams.get('code');
  
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [quizCode, setQuizCode] = useState(codeFromUrl || '');
  const [avatarSeed, setAvatarSeed] = useState('');
  const [loading, setLoading] = useState(false);

  // Initialize avatar seed on mount
  useEffect(() => {
    const stored = getStoredAvatarSeed();
    if (stored) {
      setAvatarSeed(stored);
    } else {
      const newSeed = generateRandomSeed();
      setAvatarSeed(newSeed);
      saveAvatarSeed(newSeed);
    }
  }, []);

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    
    if (!quizCode.trim()) {
      toast.error('Please enter quiz code');
      return;
    }

    setStep(2);
  };

  const handleRandomizeAvatar = () => {
    const newSeed = generateRandomSeed();
    setAvatarSeed(newSeed);
    saveAvatarSeed(newSeed);
    toast.success('🎲 Avatar randomized!');
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Please enter your name');
      return;
    }
    
    if (!avatarSeed) {
      toast.error('Avatar not loaded');
      return;
    }

    setLoading(true);
    
    try {
      const response = await axios.post(`${API}/join`, {
        name: name.trim(),
        quizCode: quizCode.trim().toUpperCase(),
        avatarSeed: avatarSeed
      });
      
      localStorage.setItem('participantId', response.data.id);
      localStorage.setItem('participantName', response.data.name);
      localStorage.setItem('avatarSeed', response.data.avatarSeed);
      localStorage.removeItem('isAdmin');
      
      toast.success('Joined successfully!');
      navigate(`/lobby/${quizCode.toUpperCase()}`);
    } catch (error) {
      console.error('Join error:', error);
      const msg = error.response?.data?.error || 'Failed to join quiz';
      toast.error(msg);
      
      // If avatar conflict, generate new one
      if (msg.includes('avatar') || msg.includes('unique')) {
        handleRandomizeAvatar();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="quiz-theme relative overflow-hidden min-h-screen"
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}
    >
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
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
            <div 
              className="w-4 h-4 bg-white rounded-full blur-sm"
              style={{ opacity: Math.random() * 0.3 }}
            />
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">
        <Button
          variant="ghost"
          onClick={() => step === 1 ? navigate('/') : setStep(1)}
          className="absolute top-6 left-6 text-white hover:text-white hover:bg-white/20"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back
        </Button>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step1"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-md"
            >
              <motion.div
                animate={{ 
                  rotate: [0, 5, -5, 0],
                  scale: [1, 1.1, 1]
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-center mb-8"
              >
                <Sparkles className="w-20 h-20 text-yellow-300 mx-auto mb-4" />
              </motion.div>

              <Card className="glass-card rounded-3xl p-8 shadow-2xl border-2 border-white/20">
                <h1 
                  className="text-5xl font-bold mb-2 text-center text-white"
                  style={{ fontFamily: 'Fredoka, sans-serif' }}
                >
                  Join Quiz
                </h1>
                <p className="text-white/80 text-center mb-8 text-lg">
                  Enter the game PIN to start
                </p>

                <form onSubmit={handleCodeSubmit} className="space-y-6">
                  <div>
                    <Input
                      type="text"
                      value={quizCode}
                      onChange={(e) => setQuizCode(e.target.value.toUpperCase())}
                      placeholder="GAME PIN"
                      maxLength={6}
                      className="w-full bg-white/20 border-2 border-white/30 rounded-2xl px-6 py-6 text-3xl font-bold focus:border-yellow-300 focus:ring-4 focus:ring-yellow-300/20 outline-none transition-all placeholder:text-white/40 text-white text-center tracking-widest"
                      autoFocus
                    />
                  </div>

                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      type="submit"
                      disabled={loading || !quizCode.trim()}
                      className="w-full bg-yellow-400 hover:bg-yellow-500 text-purple-900 font-black text-2xl px-8 py-6 rounded-full shadow-xl disabled:opacity-50 transition-all"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      {loading ? (
                        <div className="w-6 h-6 border-3 border-purple-900 border-t-transparent rounded-full animate-spin mx-auto" />
                      ) : (
                        'Continue'
                      )}
                    </Button>
                  </motion.div>
                </form>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="step2"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-2xl"
            >
              <Card className="glass-card rounded-3xl p-8 shadow-2xl border-2 border-white/20">
                <h1 
                  className="text-4xl font-bold mb-2 text-center text-white"
                  style={{ fontFamily: 'Fredoka, sans-serif' }}
                >
                  Who are you?
                </h1>
                <p className="text-white/80 text-center mb-8">
                  Choose your name and avatar
                </p>

                <form onSubmit={handleJoin} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-white/90 mb-2">
                      Your Name
                    </label>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full bg-white/20 border-2 border-white/30 rounded-2xl px-6 py-4 text-xl font-semibold focus:border-yellow-300 focus:ring-4 focus:ring-yellow-300/20 outline-none transition-all placeholder:text-white/40 text-white"
                      maxLength={20}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-white/90 mb-3">
                      Your Avatar
                    </label>
                    
                    <div className="flex flex-col items-center gap-4">
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="relative"
                      >
                        <DicebearAvatar 
                          seed={avatarSeed}
                          size="2xl"
                          className="ring-4 ring-white/30 shadow-2xl"
                        />
                      </motion.div>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleRandomizeAvatar}
                        className="bg-white/10 border-white/30 text-white hover:bg-white/20 gap-2"
                      >
                        <Shuffle className="w-4 h-4" />
                        🎲 Randomize Avatar
                      </Button>

                      <p className="text-xs text-white/60 text-center max-w-xs">
                        Your avatar will be unique in this quiz room
                      </p>
                    </div>
                  </div>

                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      type="submit"
                      disabled={loading || !name.trim() || !avatarSeed}
                      className="w-full bg-yellow-400 hover:bg-yellow-500 text-purple-900 font-black text-2xl px-8 py-6 rounded-full shadow-xl disabled:opacity-50 transition-all"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      {loading ? (
                        <div className="w-6 h-6 border-3 border-purple-900 border-t-transparent rounded-full animate-spin mx-auto" />
                      ) : (
                        <>
                          <LogIn className="w-6 h-6 mr-2" />
                          Join Game
                        </>
                      )}
                    </Button>
                  </motion.div>
                </form>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style jsx>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
        }
      `}</style>
    </div>
  );
};

export default JoinQuiz;
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LogIn, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const JoinQuiz = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [quizCode, setQuizCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Please enter your name');
      return;
    }
    
    if (!quizCode.trim()) {
      toast.error('Please enter quiz code');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/join`, {
        name: name.trim(),
        quizCode: quizCode.trim().toUpperCase()
      });
      
      // Store participant data
      localStorage.setItem('participantId', response.data.id);
      localStorage.setItem('participantName', response.data.name);
      
      toast.success('Joined successfully!');
      navigate(`/quiz/${response.data.quizCode}`);
    } catch (error) {
      console.error('Error joining quiz:', error);
      if (error.response?.status === 404) {
        toast.error('Quiz not found or inactive');
      } else {
        toast.error('Failed to join quiz');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="quiz-theme relative overflow-hidden"
      style={{
        backgroundImage: 'url(https://images.unsplash.com/photo-1767474256408-3db5bcc42eb9?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjV8MHwxfHNlYXJjaHwzfHxhYnN0cmFjdCUyMHBsYXlmdWwlMjBnZW9tZXRyaWMlMjAzZCUyMHNoYXBlcyUyMHZpYnJhbnQlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc3MDIyNTIxM3ww&ixlib=rb-4.1.0&q=85)',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="absolute inset-0 bg-black/70" />
      
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">
        <button
          onClick={() => navigate('/')}
          className="absolute top-6 left-6 flex items-center gap-2 text-white hover:text-[#00FF94] font-semibold transition-colors"
          data-testid="back-home-button"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="glass-card rounded-3xl p-8 shadow-2xl">
            <h1 
              className="text-4xl font-bold mb-2 text-center"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
              data-testid="join-quiz-title"
            >
              Join Quiz
            </h1>
            <p className="text-gray-300 text-center mb-8" data-testid="join-quiz-subtitle">Enter your details to start playing</p>

            <form onSubmit={handleJoin} className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2" htmlFor="player-name">
                  Your Name
                </label>
                <input
                  id="player-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-black/20 border-2 border-white/10 rounded-xl px-4 py-3 text-lg focus:border-[#FF6B00] focus:ring-4 focus:ring-[#FF6B00]/20 outline-none transition-all placeholder:text-white/30 text-white"
                  data-testid="player-name-input"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-300 mb-2" htmlFor="quiz-code">
                  Quiz Code
                </label>
                <input
                  id="quiz-code"
                  type="text"
                  value={quizCode}
                  onChange={(e) => setQuizCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  className="w-full bg-black/20 border-2 border-white/10 rounded-xl px-4 py-3 text-lg focus:border-[#9D00FF] focus:ring-4 focus:ring-[#9D00FF]/20 outline-none transition-all placeholder:text-white/30 text-white uppercase tracking-wider font-bold text-center"
                  data-testid="quiz-code-input"
                />
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={loading}
                className="w-full bg-[#FF6B00] text-white font-bold py-4 px-8 rounded-full border-b-4 border-[#CC4800] hover:brightness-110 transition-all text-lg flex items-center justify-center gap-3 disabled:opacity-50"
                style={{ fontFamily: 'Fredoka, sans-serif' }}
                data-testid="join-button"
              >
                {loading ? (
                  <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <LogIn className="w-6 h-6" />
                    Join Now
                  </>
                )}
              </motion.button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default JoinQuiz;
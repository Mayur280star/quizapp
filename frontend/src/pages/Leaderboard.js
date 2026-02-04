import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Trophy, Crown, Medal, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Leaderboard = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ws, setWs] = useState(null);

  useEffect(() => {
    fetchLeaderboard();
    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const socket = new WebSocket(`${wsUrl}/ws/${code}`);

    socket.onopen = () => {
      console.log('WebSocket connected');
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'leaderboard_update') {
        setLeaderboard(data.leaderboard);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    setWs(socket);
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await axios.get(`${API}/leaderboard/${code}`);
      setLeaderboard(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      toast.error('Failed to load leaderboard');
      setLoading(false);
    }
  };

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1:
        return <Crown className="w-8 h-8 text-[#FFD700]" data-testid="rank-1-icon" />;
      case 2:
        return <Medal className="w-8 h-8 text-[#C0C0C0]" data-testid="rank-2-icon" />;
      case 3:
        return <Medal className="w-8 h-8 text-[#CD7F32]" data-testid="rank-3-icon" />;
      default:
        return <span className="text-2xl font-bold text-gray-400" data-testid={`rank-${rank}-number`}>#{rank}</span>;
    }
  };

  const getRankStyle = (rank) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-400/20 to-orange-500/20 border-yellow-400/50 scale-105';
      case 2:
        return 'bg-gradient-to-r from-gray-300/20 to-gray-400/20 border-gray-400/50';
      case 3:
        return 'bg-gradient-to-r from-orange-300/20 to-orange-400/20 border-orange-400/50';
      default:
        return 'bg-white/5 border-white/10';
    }
  };

  if (loading) {
    return (
      <div 
        className="quiz-theme min-h-screen flex items-center justify-center"
        style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1769454296960-889bf3f4bac7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwyfHxlc3BvcnRzJTIwZ2FtaW5nJTIwdHJvcGh5JTIwbmVvbiUyMHZpYnJhbnR8ZW58MHx8fHwxNzcwMjI1MjE0fDA&ixlib=rb-4.1.0&q=85)',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div className="absolute inset-0 bg-black/80" />
        <div className="relative z-10 w-16 h-16 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div 
      className="quiz-theme min-h-screen"
      style={{
        backgroundImage: 'url(https://images.unsplash.com/photo-1769454296960-889bf3f4bac7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwyfHxlc3BvcnRzJTIwZ2FtaW5nJTIwdHJvcGh5JTIwbmVvbiUyMHZpYnJhbnR8ZW58MHx8fHwxNzcwMjI1MjE0fDA&ixlib=rb-4.1.0&q=85)',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="absolute inset-0 bg-black/85" />
      
      <div className="relative z-10 min-h-screen p-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              className="inline-block mb-4"
            >
              <Trophy className="w-20 h-20 text-[#FFD700]" data-testid="leaderboard-trophy-icon" />
            </motion.div>
            
            <h1 
              className="text-5xl md:text-6xl font-bold mb-4"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
              data-testid="leaderboard-title"
            >
              <span className="bg-gradient-to-r from-[#FF6B00] via-[#FF0055] to-[#9D00FF] bg-clip-text text-transparent">
                Leaderboard
              </span>
            </h1>
            
            <p className="text-xl text-gray-300 mb-2" data-testid="quiz-code-display">Quiz Code: <span className="font-bold text-[#00FF94]">{code}</span></p>
            <p className="text-sm text-gray-400" data-testid="live-updates-indicator">🔴 Live Updates</p>
          </motion.div>

          {leaderboard.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center" data-testid="empty-leaderboard">
              <Trophy className="w-16 h-16 text-gray-500 mx-auto mb-4" />
              <p className="text-xl text-gray-400">No participants yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {leaderboard.map((entry, index) => (
                  <motion.div
                    key={entry.name + entry.rank}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    layout
                    transition={{ 
                      type: 'spring',
                      stiffness: 300,
                      damping: 30
                    }}
                    className={`glass-card rounded-2xl p-6 border-2 transition-all ${getRankStyle(entry.rank)}`}
                    data-testid={`leaderboard-entry-${index}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-16 flex items-center justify-center">
                        {getRankIcon(entry.rank)}
                      </div>
                      
                      <div className="flex-1">
                        <h3 
                          className="text-xl md:text-2xl font-bold"
                          style={{ fontFamily: 'Fredoka, sans-serif' }}
                          data-testid={`participant-name-${index}`}
                        >
                          {entry.name}
                        </h3>
                        <p className="text-sm text-gray-400" data-testid={`participant-time-${index}`}>
                          Time: {entry.totalTime.toFixed(2)}s
                        </p>
                      </div>
                      
                      <div className="text-right">
                        <div 
                          className="text-3xl font-bold bg-gradient-to-r from-[#FF6B00] to-[#9D00FF] bg-clip-text text-transparent"
                          data-testid={`participant-score-${index}`}
                        >
                          {entry.score}
                        </div>
                        <p className="text-xs text-gray-400">points</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/')}
            className="mt-8 mx-auto flex items-center gap-3 bg-[#9D00FF] text-white font-bold py-4 px-8 rounded-full border-b-4 border-[#7000B8] hover:brightness-110 transition-all"
            style={{ fontFamily: 'Fredoka, sans-serif' }}
            data-testid="home-button"
          >
            <Home className="w-5 h-5" />
            Back to Home
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;
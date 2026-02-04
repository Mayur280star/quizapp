import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Plus, PlayCircle, Users, Ban } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    try {
      const response = await axios.get(`${API}/admin/quizzes`);
      setQuizzes(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching quizzes:', error);
      toast.error('Failed to load quizzes');
      setLoading(false);
    }
  };

  const toggleQuizStatus = async (code, currentStatus) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await axios.patch(`${API}/admin/quiz/${code}/status?status=${newStatus}`);
      toast.success(`Quiz ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      fetchQuizzes();
    } catch (error) {
      console.error('Error updating quiz status:', error);
      toast.error('Failed to update quiz status');
    }
  };

  const viewLeaderboard = (code) => {
    navigate(`/leaderboard/${code}`);
  };

  return (
    <div className="admin-theme min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 
            className="text-4xl md:text-5xl font-bold mb-4 text-[#1A1025]"
            style={{ fontFamily: 'Fredoka, sans-serif' }}
            data-testid="admin-dashboard-title"
          >
            Admin Dashboard
          </h1>
          <p className="text-lg text-gray-600" data-testid="admin-dashboard-subtitle">Manage your quizzes and monitor live participants</p>
        </motion.div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/admin/create')}
          className="bg-[#FF6B00] text-white font-bold py-4 px-8 rounded-full border-b-4 border-[#CC4800] hover:brightness-110 transition-all mb-8 flex items-center gap-3 text-lg"
          style={{ fontFamily: 'Fredoka, sans-serif' }}
          data-testid="create-new-quiz-button"
        >
          <Plus className="w-6 h-6" />
          Create New Quiz
        </motion.button>

        {loading ? (
          <div className="text-center py-12" data-testid="loading-state">
            <div className="inline-block w-12 h-12 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl shadow-lg" data-testid="empty-state">
            <PlayCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No quizzes created yet. Start by creating your first quiz!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz, index) => (
              <motion.div
                key={quiz.code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-2xl shadow-xl p-6 border-2 border-gray-100 hover:border-[#9D00FF] transition-all"
                data-testid={`quiz-card-${quiz.code}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-[#1A1025] mb-1" style={{ fontFamily: 'Fredoka, sans-serif' }} data-testid={`quiz-title-${quiz.code}`}>
                      {quiz.title}
                    </h3>
                    <p className="text-sm text-gray-500" data-testid={`quiz-code-${quiz.code}`}>Code: <span className="font-bold text-[#FF6B00]">{quiz.code}</span></p>
                  </div>
                  <span 
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      quiz.status === 'active' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-red-100 text-red-700'
                    }`}
                    data-testid={`quiz-status-${quiz.code}`}
                  >
                    {quiz.status}
                  </span>
                </div>

                <div className="space-y-2 mb-4 text-sm text-gray-600">
                  <p data-testid={`quiz-questions-${quiz.code}`}>📝 {quiz.questionsCount} questions</p>
                  <p data-testid={`quiz-duration-${quiz.code}`}>⏱️ {quiz.duration} minutes</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => viewLeaderboard(quiz.code)}
                    className="flex-1 bg-[#9D00FF] text-white font-semibold py-2 px-4 rounded-lg hover:brightness-110 transition-all flex items-center justify-center gap-2"
                    data-testid={`view-leaderboard-${quiz.code}`}
                  >
                    <Users className="w-4 h-4" />
                    View
                  </button>
                  <button
                    onClick={() => toggleQuizStatus(quiz.code, quiz.status)}
                    className={`flex-1 font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2 ${
                      quiz.status === 'active'
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                    data-testid={`toggle-status-${quiz.code}`}
                  >
                    {quiz.status === 'active' ? (
                      <><Ban className="w-4 h-4" /> Disable</>
                    ) : (
                      <><PlayCircle className="w-4 h-4" /> Enable</>
                    )}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
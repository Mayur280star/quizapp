import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus, PlayCircle, Users, Ban, MoreVertical, Search,
  Download, TrendingUp, Clock,
  BarChart3, Eye, Trash2, Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${BACKEND_URL}/api`;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [quizToDelete, setQuizToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    try {
      const response = await axios.get(`${API}/admin/quizzes`);
      setQuizzes(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Fetch quizzes error:', error);
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
      console.error('Update status error:', error);
      toast.error('Failed to update quiz status');
    }
  };

  const handleDeleteClick = (quiz) => {
    setQuizToDelete(quiz);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!quizToDelete) return;
    
    setDeleting(true);
    try {
      await axios.delete(`${API}/admin/quiz/${quizToDelete.code}`);
      
      // Optimistic UI update
      setQuizzes(prev => prev.filter(q => q.code !== quizToDelete.code));
      
      toast.success(`Quiz "${quizToDelete.title}" deleted successfully`);
      setDeleteDialogOpen(false);
      setQuizToDelete(null);
    } catch (error) {
      console.error('Delete quiz error:', error);
      toast.error('Failed to delete quiz');
    } finally {
      setDeleting(false);
    }
  };

  const handleStartQuiz = (code) => {
    localStorage.setItem('isAdmin', 'true');
    navigate(`/admin/control/${code}`);
  };

  const filteredQuizzes = quizzes.filter(quiz => {
    const matchesSearch = quiz.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         quiz.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || quiz.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: quizzes.length,
    active: quizzes.filter(q => q.status === 'active').length,
    inactive: quizzes.filter(q => q.status === 'inactive').length,
    totalParticipants: quizzes.reduce((sum, q) => sum + (q.participantCount || 0), 0)
  };

  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 
                className="text-4xl font-bold text-gray-900 mb-2"
                style={{ fontFamily: 'Fredoka, sans-serif' }}
              >
                Quiz Dashboard
              </h1>
              <p className="text-gray-600">Create and manage your interactive quizzes</p>
            </div>

            <Button
              onClick={() => navigate('/admin/create')}
              size="lg"
              className="bg-[#FF6B00] hover:bg-[#E55F00] text-white gap-2 shadow-lg"
            >
              <Plus className="w-5 h-5" />
              Create Quiz
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="border-2">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-medium">
                <BarChart3 className="w-4 h-4" />
                Total Quizzes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-medium text-green-700">
                <PlayCircle className="w-4 h-4" />
                Active
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-700">{stats.active}</div>
            </CardContent>
          </Card>

          <Card className="border-2 border-gray-200">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-medium">
                <Ban className="w-4 h-4" />
                Inactive
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-600">{stats.inactive}</div>
            </CardContent>
          </Card>

          <Card className="border-2 border-purple-200 bg-purple-50">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-medium text-purple-700">
                <Users className="w-4 h-4" />
                Total Players
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-700">{stats.totalParticipants}</div>
            </CardContent>
          </Card>
        </div>

        <div className="bg-white rounded-xl border-2 border-gray-200 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="text"
                placeholder="Search quizzes by title or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Tabs value={filterStatus} onValueChange={setFilterStatus} className="w-auto">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="inactive">Inactive</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block w-12 h-12 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredQuizzes.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-gray-300">
            <PlayCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No quizzes found</h3>
            <p className="text-gray-500 mb-6">
              {searchQuery ? 'Try adjusting your search' : 'Start by creating your first quiz!'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => navigate('/admin/create')}
                className="bg-[#FF6B00] hover:bg-[#E55F00]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Quiz
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredQuizzes.map((quiz, index) => (
              <motion.div
                key={quiz.code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="border-2 hover:border-[#8B5CF6] transition-all group h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-3">
                      <Badge
                        variant={quiz.status === 'active' ? 'default' : 'secondary'}
                        className={quiz.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}
                      >
                        {quiz.status}
                      </Badge>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/leaderboard/${quiz.code}`)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Leaderboard
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleQuizStatus(quiz.code, quiz.status)}>
                            {quiz.status === 'active' ? (
                              <>
                                <Ban className="w-4 h-4 mr-2" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <PlayCircle className="w-4 h-4 mr-2" />
                                Activate
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Download className="w-4 h-4 mr-2" />
                            Export Results
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-red-600"
                            onClick={() => handleDeleteClick(quiz)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <CardTitle 
                      className="text-xl mb-2 group-hover:text-[#8B5CF6] transition-colors"
                      style={{ fontFamily: 'Fredoka, sans-serif' }}
                    >
                      {quiz.title}
                    </CardTitle>
                    
                    <CardDescription className="font-mono text-sm">
                      Code: <span className="font-bold text-[#FF6B00]">{quiz.code}</span>
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span>{quiz.questionsCount} questions • {quiz.duration} min</span>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Users className="w-4 h-4" />
                        <span>{quiz.participantCount || 0} participants</span>
                      </div>

                      {quiz.lastPlayed && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <TrendingUp className="w-4 h-4" />
                          <span>Last played: {new Date(quiz.lastPlayed).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => navigate(`/leaderboard/${quiz.code}`)}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      
                      <Button
                        onClick={() => handleStartQuiz(quiz.code)}
                        size="sm"
                        disabled={quiz.status !== 'active'}
                        className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-50"
                      >
                        <PlayCircle className="w-4 h-4 mr-1" />
                        Start
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quiz</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "<strong>{quizToDelete?.title}</strong>"? This action cannot be undone and will delete all associated participant data and results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete Quiz'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminDashboard;
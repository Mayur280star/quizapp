import { BrowserRouter, Routes, Route, lazy, Suspense } from 'react-router-dom';
import Home from './pages/Home';
import AdminDashboard from './pages/AdminDashboard';
import JoinQuiz from './pages/JoinQuiz';
import QuizPlay from './pages/QuizPlay';
import Leaderboard from './pages/Leaderboard';
import { Toaster } from 'sonner';
import './App.css';

const CreateQuiz = lazy(() => import('./pages/CreateQuiz'));

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-12 h-12 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin"></div></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/create" element={<CreateQuiz />} />
            <Route path="/join" element={<JoinQuiz />} />
            <Route path="/quiz/:code" element={<QuizPlay />} />
            <Route path="/leaderboard/:code" element={<Leaderboard />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
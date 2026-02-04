import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import AdminDashboard from './pages/AdminDashboard';
import CreateQuiz from './pages/CreateQuiz';
import JoinQuiz from './pages/JoinQuiz';
import QuizPlay from './pages/QuizPlay';
import Leaderboard from './pages/Leaderboard';
import { Toaster } from 'sonner';
import './App.css';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/create" element={<CreateQuiz />} />
          <Route path="/join" element={<JoinQuiz />} />
          <Route path="/quiz/:code" element={<QuizPlay />} />
          <Route path="/leaderboard/:code" element={<Leaderboard />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
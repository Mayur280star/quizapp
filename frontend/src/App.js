import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import AdminDashboard from './pages/AdminDashboard';
import JoinQuiz from './pages/JoinQuiz';
import QuizLobby from './pages/Quizlobby';
import AdminControl from './pages/AdminControl';
import QuizPlay from './pages/QuizPlay';
import Leaderboard from './pages/Leaderboard';
import FinalPodium from './pages/FinalPodium';
import CreateQuiz from './pages/CreateQuiz';
import { Toaster } from 'sonner';
import './App.css';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="w-12 h-12 border-4 border-[#FF6B00] border-t-transparent rounded-full animate-spin"></div>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/create" element={<CreateQuiz />} />
            <Route path="/admin/control/:code" element={<AdminControl />} />
            <Route path="/join" element={<JoinQuiz />} />
            <Route path="/lobby/:code" element={<QuizLobby />} />
            <Route path="/quiz/:code" element={<QuizPlay />} />
            <Route path="/leaderboard/:code" element={<Leaderboard />} />
            <Route path="/podium/:code" element={<FinalPodium />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
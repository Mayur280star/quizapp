import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Save, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function CreateQuiz() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(10);
  const [q1Text, setQ1Text] = useState('');
  const [q1Opt0, setQ1Opt0] = useState('');
  const [q1Opt1, setQ1Opt1] = useState('');
  const [q1Opt2, setQ1Opt2] = useState('');
  const [q1Opt3, setQ1Opt3] = useState('');
  const [q1Correct, setQ1Correct] = useState(0);
  const [q1Time, setQ1Time] = useState(30);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error('Please enter a quiz title');
      return;
    }
    
    if (!q1Text.trim() || !q1Opt0.trim() || !q1Opt1.trim() || !q1Opt2.trim() || !q1Opt3.trim()) {
      toast.error('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const quizData = {
        title,
        duration,
        questions: [{
          question: q1Text,
          options: [q1Opt0, q1Opt1, q1Opt2, q1Opt3],
          correctAnswer: q1Correct,
          timeLimit: q1Time
        }]
      };

      const response = await axios.post(`${API}/admin/quiz`, quizData);
      toast.success(`Quiz created! Code: ${response.data.code}`);
      navigate('/admin');
    } catch (error) {
      console.error('Error creating quiz:', error);
      toast.error('Failed to create quiz');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-theme min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6 font-semibold"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </button>

        <h1 className="text-4xl font-bold mb-8 text-[#1A1025]" style={{ fontFamily: 'Fredoka, sans-serif' }}>
          Create New Quiz
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">Quiz Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., General Knowledge Quiz"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#FF6B00] focus:outline-none"
            />
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">Duration (minutes)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min="1"
              max="120"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#FF6B00] focus:outline-none"
            />
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h3 className="text-lg font-bold text-gray-700 mb-4">Question 1</h3>
            
            <input
              type="text"
              value={q1Text}
              onChange={(e) => setQ1Text(e.target.value)}
              placeholder="Enter your question"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl mb-4"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div className="flex items-center gap-2">
                <input type="radio" name="correct" checked={q1Correct === 0} onChange={() => setQ1Correct(0)} />
                <input
                  type="text"
                  value={q1Opt0}
                  onChange={(e) => setQ1Opt0(e.target.value)}
                  placeholder="Option 1"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" name="correct" checked={q1Correct === 1} onChange={() => setQ1Correct(1)} />
                <input
                  type="text"
                  value={q1Opt1}
                  onChange={(e) => setQ1Opt1(e.target.value)}
                  placeholder="Option 2"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" name="correct" checked={q1Correct === 2} onChange={() => setQ1Correct(2)} />
                <input
                  type="text"
                  value={q1Opt2}
                  onChange={(e) => setQ1Opt2(e.target.value)}
                  placeholder="Option 3"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" name="correct" checked={q1Correct === 3} onChange={() => setQ1Correct(3)} />
                <input
                  type="text"
                  value={q1Opt3}
                  onChange={(e) => setQ1Opt3(e.target.value)}
                  placeholder="Option 4"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Time Limit (seconds)</label>
              <input
                type="number"
                value={q1Time}
                onChange={(e) => setQ1Time(Number(e.target.value))}
                min="5"
                max="300"
                className="w-32 px-3 py-2 border-2 border-gray-200 rounded-lg"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FF6B00] text-white font-bold py-5 px-8 rounded-full border-b-4 border-[#CC4800] disabled:opacity-50"
            style={{ fontFamily: 'Fredoka, sans-serif' }}
          >
            {loading ? 'Creating...' : (
              <>
                <Save className="inline w-6 h-6 mr-2" />
                Create Quiz
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default CreateQuiz;

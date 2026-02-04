import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Plus, Minus, Save, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CreateQuiz = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(10);
  const [questions, setQuestions] = useState([
    { question: '', options: ['', '', '', ''], correctAnswer: 0, timeLimit: 30 }
  ]);
  const [loading, setLoading] = useState(false);

  const addQuestion = () => {
    setQuestions([...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0, timeLimit: 30 }]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    setQuestions(updated);
  };

  const updateOption = (qIndex, oIndex, value) => {
    const updated = [...questions];
    updated[qIndex].options[oIndex] = value;
    setQuestions(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!title.trim()) {
      toast.error('Please enter a quiz title');
      return;
    }
    
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        toast.error(`Question ${i + 1} is empty`);
        return;
      }
      if (q.options.some(opt => !opt.trim())) {
        toast.error(`All options for Question ${i + 1} must be filled`);
        return;
      }
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/admin/quiz`, {
        title,
        duration,
        questions
      });
      
      toast.success(`Quiz created! Code: ${response.data.code}`);
      navigate('/admin');
    } catch (error) {
      console.error('Error creating quiz:', error);
      toast.error('Failed to create quiz');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-theme min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6 font-semibold"
            data-testid="back-to-dashboard-button"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>

          <h1 
            className="text-4xl md:text-5xl font-bold mb-8 text-[#1A1025]"
            style={{ fontFamily: 'Fredoka, sans-serif' }}
            data-testid="create-quiz-title"
          >
            Create New Quiz
          </h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="quiz-title">
                Quiz Title
              </label>
              <input
                id="quiz-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., General Knowledge Quiz"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#FF6B00] focus:outline-none transition-all"
                data-testid="quiz-title-input"
              />
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="quiz-duration">
                Quiz Duration (minutes)
              </label>
              <input
                id="quiz-duration"
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min="1"
                max="120"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#FF6B00] focus:outline-none transition-all"
                data-testid="quiz-duration-input"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-[#1A1025]" style={{ fontFamily: 'Fredoka, sans-serif' }} data-testid="questions-section-title">
                  Questions
                </h2>
                <button
                  type="button"
                  onClick={addQuestion}
                  className="bg-[#00FF94] text-black font-bold py-2 px-6 rounded-full hover:brightness-110 transition-all flex items-center gap-2"
                  data-testid="add-question-button"
                >
                  <Plus className="w-5 h-5" />
                  Add Question
                </button>
              </div>

              {questions.map((q, qIndex) => (
                <motion.div
                  key={qIndex}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-2xl shadow-lg p-6"
                  data-testid={`question-${qIndex}`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-bold text-gray-700" data-testid={`question-label-${qIndex}`}>Question {qIndex + 1}</h3>
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(qIndex)}
                        className="text-red-500 hover:text-red-700 font-semibold flex items-center gap-1"
                        data-testid={`remove-question-${qIndex}`}
                      >
                        <Minus className="w-4 h-4" />
                        Remove
                      </button>
                    )}
                  </div>

                  <input
                    type="text"
                    value={q.question}
                    onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                    placeholder="Enter your question"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#9D00FF] focus:outline-none transition-all mb-4"
                    data-testid={`question-input-${qIndex}`}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {q.options.map((opt, oIndex) => (
                      <div key={oIndex} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${qIndex}`}
                          checked={q.correctAnswer === oIndex}
                          onChange={() => updateQuestion(qIndex, 'correctAnswer', oIndex)}
                          className="w-5 h-5 text-[#00FF94] focus:ring-[#00FF94]"
                          data-testid={`correct-answer-radio-${qIndex}-${oIndex}`}
                        />
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                          placeholder={`Option ${oIndex + 1}`}
                          className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[#9D00FF] focus:outline-none transition-all"
                          data-testid={`option-input-${qIndex}-${oIndex}`}
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Time Limit (seconds)
                    </label>
                    <input
                      type="number"
                      value={q.timeLimit}
                      onChange={(e) => updateQuestion(qIndex, 'timeLimit', Number(e.target.value))}
                      min="5"
                      max="300"
                      className="w-32 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[#9D00FF] focus:outline-none transition-all"
                      data-testid={`time-limit-input-${qIndex}`}
                    />
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="w-full bg-[#FF6B00] text-white font-bold py-5 px-8 rounded-full border-b-4 border-[#CC4800] hover:brightness-110 transition-all text-lg flex items-center justify-center gap-3 disabled:opacity-50"
              style={{ fontFamily: 'Fredoka, sans-serif' }}
              data-testid="save-quiz-button"
            >
              {loading ? (
                <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Save className="w-6 h-6" />
                  Create Quiz
                </>
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default CreateQuiz;
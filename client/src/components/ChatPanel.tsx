import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import './ChatPanel.css';

interface ChatPanelProps {
  path: string[];
  onAsk: (question: string, path: string[]) => Promise<{ answer: string }>;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'When did the vendor first learn of the defect?',
  'Which document is the weakest link in this chain?',
];

export default function ChatPanel({ path, onAsk }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Ask me anything about the evidence chain.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await onAsk(text, path);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.answer }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, I could not reach the case assistant.' }]);
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div className="chat-panel glass">
      <div className="chat-header">
        <h4>Your case assistant</h4>
      </div>

      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant typing">
            <span className="typing-label">Analyzing your case — this can take a few minutes…</span>
            <span className="dots">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-suggestions">
        {SUGGESTIONS.map((q) => (
          <button key={q} className="suggestion-chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          type="text"
          placeholder="Ask about the evidence..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="send-btn" disabled={!input.trim() || loading}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

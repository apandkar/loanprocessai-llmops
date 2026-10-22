import React, { useState, useRef, useEffect } from 'react';
import { sendLendWiseMessage } from '../services/api';
import './LendWise.css';

function LendWise({ user, activeCaseId, openWithCase, onOpened }) {
  const [isOpen, setIsOpen] = useState(false);

  const getWelcomeMessage = () => {
    const name = user?.name ? `, ${user.name.split(' ')[0]}` : '';
    const role = user?.role || 'customer';

    if (role === 'customer') {
      return {
        role: 'assistant',
        text: `Hi${name}! I'm **LoanAssist**, your loan progression assistant.\n\nAsk me about your application or Bank policy guidance.`,
        suggestions: ['What is my application status?', 'What documents do I need?', 'What are SBA loan documentation requirements?'],
      };
    }
    if (role === 'banker') {
      return {
        role: 'assistant',
        text: `Hi${name}! I'm **LoanAssist**, your underwriting assistant.\n\nAsk me about cases, pipeline status, or Bank policy guidance.`,
        suggestions: ['What is the minimum DSCR guideline?', 'What does OCC say about commercial real estate lending?', 'Cases pending review'],
      };
    }

    return {
      role: 'assistant',
      text: `Hi${name}! I'm **LoanAssist**, your operations assistant.\n\nAsk me about operational status or Bank policy evidence.`,
      suggestions: ['Show all cases', 'What is the minimum DSCR guideline?', 'Check KYC compliance'],
    };
  };

  const [messages, setMessages] = useState([getWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);


  useEffect(() => {
    if (openWithCase && openWithCase.caseId) {
      const bizName = openWithCase.bizName || 'your application';
      setMessages([
        {
          role: 'assistant',
          text: `👋 I'm now connected to **${bizName}**'s case. I have all the details loaded — status, documents, KYC, financials.\n\nHow can I help you with this application?`,
          suggestions: ['What\'s the status?', 'Any missing documents?', 'Show KYC results', 'Check financial ratios'],
        },
      ]);
      setIsOpen(true);
      if (onOpened) onOpened();
    }
  }, [openWithCase, onOpened]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;

    const userMsg = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await sendLendWiseMessage(
        activeCaseId || null,
        text.trim(),
        user?.role || 'customer',
        user?.email || null
      );

      const ragSources = response.rag?.sources || [];
      const sourceNames = [...new Set(ragSources.map(s => s.title || s.parent_id).filter(Boolean))];
      const sourceSummary = response.route === 'rag' && sourceNames.length > 0
        ? `\n\n**Retrieved evidence:**\n${sourceNames.map(name => `- ${name}`).join('\n')}`
        : '';

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `${response.message || response.reply || 'I received your message.'}${sourceSummary}`,
          suggestions: response.suggestions || [],
        },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: 'Sorry, I encountered an error. Please try again.',
          suggestions: ['Help'],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (suggestion) => {
    sendMessage(suggestion);
  };


  const renderText = (text) => {
    if (!text) return null;
    
    const lines = text.split('\n');
    const elements = [];
    let listItems = [];
    let inList = false;
    
    const processInlineMarkdown = (line) => {
      // Handle bold (**text**) and inline code (`code`)
      return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={j} style={{
            background: '#f0f4f8',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '0.9em',
            fontFamily: 'monospace',
            color: '#0d47a1'
          }}>{part.slice(1, -1)}</code>;
        }
        return part;
      });
    };
    
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ');
      
      if (isBullet) {
        if (!inList) {
          inList = true;
          listItems = [];
        }
        const content = trimmed.slice(2); // Remove "* " or "- "
        listItems.push(<li key={`li-${i}`}>{processInlineMarkdown(content)}</li>);
      } else {
        // End any open list
        if (inList && listItems.length > 0) {
          elements.push(
            <ul key={`ul-${i}`} style={{ margin: '8px 0', paddingLeft: '20px' }}>
              {listItems}
            </ul>
          );
          listItems = [];
          inList = false;
        }
        
        // Regular line
        if (trimmed) {
          elements.push(
            <React.Fragment key={i}>
              {processInlineMarkdown(line)}
              {i < lines.length - 1 && <br />}
            </React.Fragment>
          );
        } else if (i < lines.length - 1) {
          elements.push(<br key={i} />);
        }
      }
    });
    
    // Close any remaining list
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key="ul-final" style={{ margin: '8px 0', paddingLeft: '20px' }}>
          {listItems}
        </ul>
      );
    }
    
    return elements;
  };

  return (
    <div className="lendwise-container">
      {}
      {isOpen && (
        <div className="lendwise-window">
          <div className="lendwise-header">
            <div className="lendwise-header-left">
              <div className="lendwise-header-icon">
                <img src="/icons/agent-icon.svg" alt="" className="lendwise-logo" />
              </div>
              <div>
                <div className="lendwise-title">LoanAssist</div>
                <div className="lendwise-subtitle">Loan Progression Assistant</div>
              </div>
            </div>
            <button className="lendwise-close" onClick={() => setIsOpen(false)}>×</button>
          </div>

          <div className="lendwise-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`lendwise-msg lendwise-msg-${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="lendwise-avatar">
                    <img src="/icons/agent-icon.svg" alt="" />
                  </div>
                )}
                <div className={`lendwise-bubble lendwise-bubble-${msg.role}`}>
                  <div className="lendwise-text">{renderText(msg.text)}</div>
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="lendwise-suggestions">
                      {msg.suggestions.map((s, j) => (
                        <button
                          key={j}
                          className="lendwise-suggestion-btn"
                          onClick={() => handleSuggestion(s)}
                          disabled={loading}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="lendwise-msg lendwise-msg-assistant">
                <div className="lendwise-avatar">
                  <img src="/icons/agent-icon.svg" alt="" />
                </div>
                <div className="lendwise-bubble lendwise-bubble-assistant">
                  <div className="lendwise-typing">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form className="lendwise-input-area" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="lendwise-input"
              placeholder="Ask LoanAssist anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" className="lendwise-send" disabled={loading || !input.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {}
      <button
        className={`lendwise-fab ${isOpen ? 'lendwise-fab-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="LoanAssist"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M18 6L6 18" /><path d="M6 6L18 18" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 512 512" fill="none" stroke="white" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
            <path d="M256 80C141 80 48 154 48 245c0 49 30 93 78 124l-18 72 74-40c23 7 48 11 74 11 115 0 208-74 208-167S371 80 256 80z"/>
          </svg>
        )}
        {!isOpen && <span className="lendwise-fab-label"></span>}
      </button>
    </div>
  );
}

export default LendWise;

import React, { useReducer, useEffect } from 'react';

// Types
interface ContentChunk {
  id: string;
  content: string;
  tokens: number;
  isSelected: boolean;
}

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'code';
  author: string;
  avatar: string;
  time: string;
  content?: string;
  paragraphs?: ContentChunk[];
  tokens: number;
  isSelected: boolean;
  shortcut?: string;
}

interface TokenStats {
  total: number;
  selected: number;
  percentSelected: number;
}

interface State {
  messages: Message[];
  selectionMode: 'ninja' | 'visual' | 'smart';
  contentFilter: 'all' | 'code' | 'lists' | 'images' | 'user' | 'ai';
  tokens: TokenStats;
}

type Action =
  | { type: 'SET_SELECTION_MODE'; payload: 'ninja' | 'visual' | 'smart' }
  | { type: 'SET_CONTENT_FILTER'; payload: 'all' | 'code' | 'lists' | 'images' | 'user' | 'ai' }
  | { type: 'TOGGLE_MESSAGE_SELECTION'; payload: string }
  | { type: 'TOGGLE_PARAGRAPH_SELECTION'; payload: { messageId: string; paragraphId: string } }
  | { type: 'SELECT_ALL_CODE' }
  | { type: 'SELECT_ALL_LISTS' }
  | { type: 'INVERT_SELECTION' }
  | { type: 'ADD_IMPLEMENTATION_SECTION' };

// Sample data for demonstration
const SAMPLE_MESSAGES: Message[] = [
  {
    id: 'msg1',
    type: 'user',
    author: 'You',
    avatar: 'VP',
    time: '10:15 AM',
    content: "I need to analyze a large dataset of customer transactions to identify purchasing patterns and predict future behavior. What machine learning techniques would you recommend?",
    tokens: 650,
    isSelected: true,
    shortcut: 'Ctrl+1'
  },
  {
    id: 'msg2',
    type: 'assistant',
    author: 'Assistant',
    avatar: 'AI',
    time: '10:16 AM',
    paragraphs: [
      {
        id: 'para1',
        content: "For analyzing customer transaction data and predicting future behavior, several machine learning approaches can be effective. Let me outline the key techniques and their applications.",
        tokens: 420,
        isSelected: true,
      },
      {
        id: 'para2',
        content: "Recommended ML Techniques:\n1. Clustering (K-means, DBSCAN) - Identify natural groupings of similar customers\n2. Classification (Random Forest, XGBoost) - Predict categorical outcomes like churn\n3. Regression models - Forecast continuous values like future spending",
        tokens: 750,
        isSelected: true,
      },
      {
        id: 'para3',
        content: "Implementation Approach:\nI recommend starting with exploratory data analysis, then feature engineering before applying these models. This will help identify meaningful patterns in your transaction data.",
        tokens: 280,
        isSelected: false,
      }
    ],
    tokens: 1450,
    shortcut: 'Ctrl+2'
  },
  {
    id: 'msg3',
    type: 'code',
    author: 'Code: Customer Clustering Example',
    avatar: 'AI',
    time: '10:17 AM',
    content: `import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

# Load and prepare transaction data
df = pd.read_csv('customer_transactions.csv')
features = ['frequency', 'recency', 'monetary_value']`,
    tokens: 910,
    isSelected: true,
    shortcut: 'Ctrl+3'
  }
];

// Initial state
const initialState: State = {
  messages: SAMPLE_MESSAGES,
  selectionMode: 'ninja',
  contentFilter: 'all',
  tokens: {
    total: 10000,
    selected: 7021,
    percentSelected: 70
  }
};

// Helper function to count selected tokens
const countSelectedTokens = (messages: Message[]): number => {
  let count = 0;
  
  messages.forEach(message => {
    if (message.paragraphs) {
      message.paragraphs.forEach(p => {
        if (p.isSelected) {
          count += p.tokens;
        }
      });
    } else if (message.isSelected) {
      count += message.tokens;
    }
  });
  
  return count;
};

// Reducer function
const appReducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_SELECTION_MODE':
      return {
        ...state,
        selectionMode: action.payload
      };
    
    case 'SET_CONTENT_FILTER':
      return {
        ...state,
        contentFilter: action.payload
      };
    
    case 'TOGGLE_MESSAGE_SELECTION': {
      const messageId = action.payload;
      const updatedMessages = state.messages.map(message => {
        if (message.id === messageId) {
          // If this is a normal message, toggle its selection
          if (!message.paragraphs) {
            return {
              ...message,
              isSelected: !message.isSelected
            };
          }
          // If this is a message with paragraphs, toggle all paragraphs
          else {
            const allSelected = message.paragraphs.every(p => p.isSelected);
            const updatedParagraphs = message.paragraphs.map(p => ({
              ...p,
              isSelected: !allSelected
            }));
            return {
              ...message,
              paragraphs: updatedParagraphs
            };
          }
        }
        return message;
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    case 'TOGGLE_PARAGRAPH_SELECTION': {
      const { messageId, paragraphId } = action.payload;
      const updatedMessages = state.messages.map(message => {
        if (message.id === messageId && message.paragraphs) {
          const updatedParagraphs = message.paragraphs.map(p => {
            if (p.id === paragraphId) {
              return {
                ...p,
                isSelected: !p.isSelected
              };
            }
            return p;
          });
          return {
            ...message,
            paragraphs: updatedParagraphs
          };
        }
        return message;
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    case 'SELECT_ALL_CODE': {
      const updatedMessages = state.messages.map(message => {
        if (message.type === 'code') {
          return {
            ...message,
            isSelected: true
          };
        }
        return message;
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    case 'SELECT_ALL_LISTS': {
      // Find paragraphs that contain lists (starting with numbers or bullets)
      const listRegex = /^\s*(\d+\.\s|\*\s|-\s)/m;
      
      const updatedMessages = state.messages.map(message => {
        if (message.paragraphs) {
          const updatedParagraphs = message.paragraphs.map(p => {
            if (listRegex.test(p.content)) {
              return {
                ...p,
                isSelected: true
              };
            }
            return p;
          });
          return {
            ...message,
            paragraphs: updatedParagraphs
          };
        }
        return message;
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    case 'INVERT_SELECTION': {
      const updatedMessages = state.messages.map(message => {
        if (message.paragraphs) {
          const updatedParagraphs = message.paragraphs.map(p => ({
            ...p,
            isSelected: !p.isSelected
          }));
          return {
            ...message,
            paragraphs: updatedParagraphs
          };
        }
        return {
          ...message,
          isSelected: !message.isSelected
        };
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    case 'ADD_IMPLEMENTATION_SECTION': {
      const updatedMessages = state.messages.map(message => {
        if (message.id === 'msg2' && message.paragraphs) {
          const updatedParagraphs = message.paragraphs.map(p => {
            if (p.id === 'para3') {
              return {
                ...p,
                isSelected: true
              };
            }
            return p;
          });
          return {
            ...message,
            paragraphs: updatedParagraphs
          };
        }
        return message;
      });
      
      // Recalculate token stats
      const selected = countSelectedTokens(updatedMessages);
      
      return {
        ...state,
        messages: updatedMessages,
        tokens: {
          ...state.tokens,
          selected,
          percentSelected: Math.round((selected / state.tokens.total) * 100)
        }
      };
    }
    
    default:
      return state;
  }
};

// Icon components
const Icon = {
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  ),
  Plus: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  )
};

// Header Component
const Header: React.FC<{ tokens: TokenStats }> = ({ tokens }) => {
  return (
    <header className="bg-gray-900 text-white px-6 py-3 flex items-center">
      <h1 className="text-xl font-semibold mr-4">ContextNexus</h1>
      <span className="text-gray-400 mr-6">Advanced Selection Mode</span>
      
      {/* Status Bar - Token Selection */}
      <div className="bg-gray-800 rounded-full w-48 h-7 flex items-center px-1 mr-4">
        <div className="h-5 bg-gray-700 rounded-full overflow-hidden" style={{ width: `${tokens.percentSelected}%` }}>
          <div className="h-full bg-blue-500 rounded-full"></div>
        </div>
        <span className="ml-2 text-sm">{tokens.percentSelected}% selected</span>
      </div>
      
      {/* Token Counter */}
      <div className="bg-gray-800 rounded-full px-4 py-1 mr-4">
        <span className="text-sm">{tokens.selected.toLocaleString()} / {tokens.total.toLocaleString()} tokens</span>
      </div>
      
      {/* Apply Button */}
      <button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1 rounded-full">
        Apply
      </button>
      
      {/* User Avatar */}
      <div className="ml-auto bg-blue-500 rounded-full w-10 h-10 flex items-center justify-center">
        <span>VP</span>
      </div>
    </header>
  );
};

// Selection Toolbar Component
const SelectionToolbar: React.FC<{
  selectionMode: 'ninja' | 'visual' | 'smart';
  contentFilter: 'all' | 'code' | 'lists' | 'images' | 'user' | 'ai';
  dispatch: React.Dispatch<Action>;
}> = ({ selectionMode, contentFilter, dispatch }) => {
  return (
    <div className="bg-gray-200 px-6 py-2 flex items-center">
      {/* Selection Modes */}
      <div className="flex space-x-2 mr-10">
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${selectionMode === 'ninja' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_SELECTION_MODE', payload: 'ninja' })}
        >
          Ninja Mode
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${selectionMode === 'visual' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_SELECTION_MODE', payload: 'visual' })}
        >
          Visual Mode
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${selectionMode === 'smart' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_SELECTION_MODE', payload: 'smart' })}
        >
          Smart Select
        </button>
      </div>
      
      {/* Content Filters */}
      <div className="flex space-x-2">
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'all' })}
        >
          All
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'code' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'code' })}
        >
          Code
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'lists' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'lists' })}
        >
          Lists
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'images' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'images' })}
        >
          Images
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'user' })}
        >
          User
        </button>
        <button 
          className={`px-4 py-1.5 rounded-full text-sm ${contentFilter === 'ai' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          onClick={() => dispatch({ type: 'SET_CONTENT_FILTER', payload: 'ai' })}
        >
          AI
        </button>
      </div>
    </div>
  );
};

// Active Selection Footer
const ActiveSelectionFooter: React.FC<{ state: State, dispatch: React.Dispatch<Action> }> = ({ state, dispatch }) => {
  const selectedItems: string[] = [];
  
  // Collect all selected items
  state.messages.forEach(message => {
    if (message.paragraphs) {
      message.paragraphs.forEach(para => {
        if (para.isSelected) {
          if (para.id === 'para1') {
            selectedItems.push('Intro');
          } else if (para.id === 'para2') {
            selectedItems.push('ML Techniques');
          } else if (para.id === 'para3') {
            selectedItems.push('Implementation');
          }
        }
      });
    } else if (message.isSelected) {
      if (message.type === 'user') {
        selectedItems.push('Message 1');
      } else if (message.type === 'code') {
        selectedItems.push('Code Block');
      }
    }
  });
  
  return (
    <div className="bg-gray-800 text-white p-4 rounded-lg fixed bottom-4 left-4 right-4 mx-auto max-w-[850px] flex items-center justify-between">
      <div>
        <span className="font-medium">Active Selection:</span> {selectedItems.join(', ')} ({state.tokens.selected.toLocaleString()} tokens) — 
        <span className="ml-1 text-gray-300">
          Space to toggle • Tab to navigate • F to filter
        </span>
      </div>
      <button className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-1.5 rounded-full">
        Apply
      </button>
    </div>
  );
};

// Main NinjaSelector Component
const NinjaSelector: React.FC = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle selection on space
      if (e.code === 'Space' && (e.target as HTMLElement).classList.contains('selectable')) {
        e.preventDefault();
        const id = (e.target as HTMLElement).dataset.id;
        
        if (id && id.startsWith('para')) {
          // Find which message this paragraph belongs to
          const messageId = state.messages.find(m => 
            m.paragraphs && m.paragraphs.some(p => p.id === id)
          )?.id;
          
          if (messageId) {
            dispatch({ 
              type: 'TOGGLE_PARAGRAPH_SELECTION', 
              payload: { messageId, paragraphId: id } 
            });
          }
        } else if (id) {
          dispatch({ type: 'TOGGLE_MESSAGE_SELECTION', payload: id });
        }
      }
      
      // Ctrl+Alt+C to select all code
      if (e.ctrlKey && e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        dispatch({ type: 'SELECT_ALL_CODE' });
      }
      
      // Ctrl+Alt+L to select all lists
      if (e.ctrlKey && e.altKey && e.code === 'KeyL') {
        e.preventDefault();
        dispatch({ type: 'SELECT_ALL_LISTS' });
      }
      
      // Ctrl+I to invert selection
      if (e.ctrlKey && e.code === 'KeyI') {
        e.preventDefault();
        dispatch({ type: 'INVERT_SELECTION' });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.messages]);
  
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header tokens={state.tokens} />
      <SelectionToolbar 
        selectionMode={state.selectionMode} 
        contentFilter={state.contentFilter} 
        dispatch={dispatch} 
      />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area - This is where messages would be displayed */}
        <div className="w-full md:w-2/3 bg-gray-100 p-4 overflow-y-auto">
          <div className="bg-white p-8 rounded-lg shadow text-center">
            <h2 className="text-xl mb-4">Context Ninja Selector</h2>
            <p className="mb-4 text-gray-700">This is a placeholder for the actual message content.</p>
            <p className="text-gray-500">The complete UI would show messages with selection controls here.</p>
          </div>
          
          {/* Spacer for the fixed footer */}
          <div className="h-20"></div>
        </div>
        
        {/* Right context panel - Would be shown on larger screens */}
        <div className="hidden md:block md:w-1/3 bg-white p-4 border-l border-gray-200 overflow-y-auto">
          <div className="mb-6 p-4 bg-gray-100 rounded-lg">
            <h2 className="text-blue-900 font-medium mb-2">Current Selection</h2>
            <p>5 items selected (70% of context)</p>
          </div>
        </div>
      </div>
      
      {/* Active Selection Footer */}
      <ActiveSelectionFooter state={state} dispatch={dispatch} />
    </div>
  );
};

export default NinjaSelector;

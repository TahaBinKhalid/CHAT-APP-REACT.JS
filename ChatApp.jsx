import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged,
  setPersistence,
  inMemoryPersistence
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  onSnapshot, 
  addDoc,
  serverTimestamp,
  setLogLevel
} from 'firebase/firestore';
import { Send, Loader, User, Zap } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// --- Firebase setup from globals ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-chat-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' 
  ? __initial_auth_token 
  : null;

const App = () => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Firebase refs
  const dbRef = useRef(null);
  const authRef = useRef(null);
  const userIdRef = useRef(null);

  const messagesEndRef = useRef(null);

  // Smooth scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Init Firebase + Auth
  useEffect(() => {
    if (!firebaseConfig) {
      setError("Firebase configuration is missing. Cannot initialize.");
      setIsLoading(false);
      return;
    }

    try {
      setLogLevel('debug');

      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);

      authRef.current = auth;
      dbRef.current = db;

      // sign in
      const authenticateUser = async () => {
        try {
          await setPersistence(auth, inMemoryPersistence);

          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (authError) {
          console.warn("Custom Token Sign-in failed, falling back to anonymous:", authError.message);
          // Set error is removed to avoid premature UI display, anonymous sign-in is the final fallback
          await signInAnonymously(auth); 
        }
      };

      const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        if (user) {
          userIdRef.current = user.uid;
          setAuthReady(true);
          setIsLoading(false);
        } else {
          // no user yet — generate placeholder but don’t set authReady
          userIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : uuidv4();
        }
      });

      authenticateUser();

      return () => unsubscribeAuth();
    } catch (e) {
      console.error("Initialization Error:", e);
      setError(`App initialization failed: ${e.message}`);
      setIsLoading(false);
    }
  }, []);

  // Firestore path for messages
  const getMessagesCollectionRef = useCallback(() => {
    if (!dbRef.current) return null;
    // FIX: Included 'data' segment to ensure the collection reference path is valid (5 segments: C/D/C/D/C)
    return collection(dbRef.current, 'artifacts', appId, 'public', 'data', 'chat_messages');
  }, [appId]);

  // Listen to messages
  useEffect(() => {
    // Check for auth state and current user existence before subscribing
    if (!authReady || !dbRef.current || !authRef.current?.currentUser) return;

    const messagesRef = getMessagesCollectionRef();
    if (!messagesRef) return;

    const q = query(messagesRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMessages = [];
      snapshot.forEach((doc) => newMessages.push({ id: doc.id, ...doc.data() }));

      // sort by timestamp in memory
      newMessages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setMessages(newMessages);

      setTimeout(scrollToBottom, 100);
    }, (snapError) => {
      console.error("Firestore Snapshot Error:", snapError);
      setError(`Failed to load messages: ${snapError.message}`);
    });

    return () => unsubscribe();
  }, [authReady, getMessagesCollectionRef]);

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === '' || !dbRef.current || !userIdRef.current) return;

    const messageToSend = newMessage.trim();
    setNewMessage('');

    try {
      const messagesRef = getMessagesCollectionRef();
      if (!messagesRef) throw new Error("Database not initialized.");

      await addDoc(messagesRef, {
        text: messageToSend,
        timestamp: serverTimestamp(),
        userId: userIdRef.current,
        color: `#${(parseInt(userIdRef.current, 36) % 0xFFFFFF).toString(16).padStart(6, '0')}`
      });
    } catch (sendError) {
      console.error("Error sending message:", sendError);
      setNewMessage(messageToSend); 
      setError(`Could not send message: ${sendError.message}`);
    }
  };

  const currentUserId = userIdRef.current;

  // UI states
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader className="animate-spin text-indigo-500 w-8 h-8" />
        <span className="ml-3 text-lg font-medium text-gray-700">Connecting to Chat...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-50 p-4">
        <div className="bg-white p-6 rounded-xl shadow-lg border border-red-200">
          <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  // Main Chat UI
  return (
    <div className="font-sans antialiased bg-gray-50 min-h-screen flex justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <header className="flex items-center justify-between p-4 sm:p-6 bg-indigo-600 text-white shadow-lg">
          <h1 className="text-2xl font-extrabold flex items-center">
            <Zap className="w-6 h-6 mr-2 text-yellow-300" />
            Real-Time Chat
          </h1>
          <div className="text-xs sm:text-sm font-mono p-2 bg-indigo-700 rounded-lg flex items-center truncate max-w-[50%] sm:max-w-full">
            <User className="w-4 h-4 mr-2" />
            User ID: {currentUserId}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gray-50 custom-scrollbar">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 italic">
              Start the conversation! No messages yet.
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.userId === currentUserId;
              const displayTime = msg.timestamp 
                ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                : 'Sending...';

              return (
                <div 
                  key={msg.id} 
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex flex-col max-w-xs sm:max-w-md ${isMine ? 'items-end' : 'items-start'}`}>
                    {!isMine && (
                       <span 
                         className="text-xs font-semibold mb-1 px-2 py-0.5 rounded-full text-white"
                         style={{ backgroundColor: msg.color || '#374151' }}
                       >
                         {msg.userId.substring(0, 8)}...
                       </span>
                    )}
                    <div 
                      className={`px-4 py-3 rounded-2xl shadow-md transition-all duration-300 ease-in-out ${
                        isMine
                          ? 'bg-indigo-500 text-white rounded-br-none'
                          : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      <span className={`block mt-1 text-right ${isMine ? 'text-indigo-200' : 'text-gray-400'} text-xs`}>
                        {displayTime}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 sm:p-6 bg-gray-100 border-t border-gray-200">
          <form onSubmit={handleSendMessage} className="flex space-x-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type your message here..."
              className="flex-1 p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-150"
              disabled={!authReady}
            />
            <button
              type="submit"
              className="p-3 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-500 focus:ring-opacity-50 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!authReady || newMessage.trim() === ''}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
      
      {/* Custom scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
        
          background: #f1f1f1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #a8a8a8;
        }
      `}</style>
    </div>
  );
};

export default App;



/* Option 1 — Relax rules for testing (not safe for production)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/public/chat_messages/{messageId} {
      allow read, write: if true; // anyone can read/write
    }
  }
}


This makes your chat publicly writable — good for quick tests, but not secure.

Option 2 — Require authentication (better)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/public/chat_messages/{messageId} {
      allow read, write: if request.auth != null; // must be signed in (anonymous or real)
    }
  }
}


This way, only signed-in users (including anonymous ones) can interact.

Option 3 — Stricter (recommended for real apps)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/public/chat_messages/{messageId} {
      allow read: if true; // anyone can read
      allow create: if request.auth != null 
                    && request.resource.data.userId == request.auth.uid;
      allow delete: if false; // nobody can delete
    }
  }
}


This ensures:

Everyone can read the chat.

Only authenticated users can write messages.

A user can only write messages as themselves.

🚦 Why your listener failed first

The error happens because Firestore doesn’t retry failed snapshots automatically when auth changes. It just says “denied” once.
That’s why in the fixed code I showed you, I made the listener wait until authReady → so your very first Firestore query goes out with a real user attached. 
*/
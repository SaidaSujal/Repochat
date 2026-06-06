'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, RepoChatApiError } from '@/lib/api';
import { RepositoryResponse, ChatResponse, CodeSnippet, Citation } from '@/lib/types';
import { MarkdownViewer } from '@/components/MarkdownViewer';
import { 
  ArrowLeft, 
  Send, 
  RotateCw, 
  AlertCircle, 
  CheckCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Code,
  Sparkles,
  Search,
  XCircle
} from 'lucide-react';

interface PageProps {
  params: {
    id: string;
  };
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text?: string;
  response?: ChatResponse;
  error?: string;
  statusText?: string;
}

export default function ChatPage({ params }: PageProps) {
  const router = useRouter();
  const repoId = parseInt(params.id, 10);
  
  const [repo, setRepo] = useState<RepositoryResponse | null>(null);
  const [repoLoading, setRepoLoading] = useState(true);
  const [query, setQuery] = useState('');
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load repo metadata
  useEffect(() => {
    const fetchMetadata = async () => {
      setRepoLoading(true);
      try {
        const data = await api.getRepositoryMetadata(repoId);
        setRepo(data);
      } catch (err: unknown) {
        console.error(err);
        // If 410 or 404, redirect back to dashboard which handles it cleanly
        router.push(`/repository/${repoId}`);
      } finally {
        setRepoLoading(false);
      }
    };

    if (!isNaN(repoId)) {
      fetchMetadata();
    } else {
      router.push('/');
    }
  }, [repoId, router]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isProcessing) return;
    
    const userMessageText = textToSend.trim().substring(0, 1000);
    setQuery('');
    
    // Add user message
    const userMsgId = Math.random().toString(36).substring(7);
    const assistantMsgId = Math.random().toString(36).substring(7);
    
    setMessages(prev => [
      ...prev,
      { id: userMsgId, sender: 'user', text: userMessageText }
    ]);
    
    setIsProcessing(true);
    setCurrentStatus('Querying ChromaDB vector database...');
    
    // Setup cancel token
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // Add temporary loading message for assistant
    setMessages(prev => [
      ...prev,
      { id: assistantMsgId, sender: 'assistant', statusText: 'Searching vector index...' }
    ]);

    // Simulated search and synthesis status steps
    const statusInterval = setInterval(() => {
      setCurrentStatus(prev => {
        if (prev.includes('Querying ChromaDB')) {
          return 'Retrieving relevant code chunks...';
        } else if (prev.includes('Retrieving')) {
          return 'Analyzing citations with Gemini RAG...';
        } else if (prev.includes('Analyzing')) {
          return 'Synthesizing answer structure...';
        }
        return prev;
      });
    }, 1800);

    try {
      const chatRes = await api.chatAboutRepository(repoId, userMessageText, controller.signal);
      
      clearInterval(statusInterval);
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMsgId 
            ? { id: assistantMsgId, sender: 'assistant', response: chatRes }
            : msg
        )
      );
    } catch (err: unknown) {
      clearInterval(statusInterval);
      let errorMsg = 'Failed to answer query. Connection error.';
      if (err instanceof Error && err.name === 'AbortError') {
        errorMsg = 'Query processing was cancelled.';
      } else if (err instanceof RepoChatApiError) {
        errorMsg = err.message;
      }
      
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMsgId 
            ? { id: assistantMsgId, sender: 'assistant', error: errorMsg }
            : msg
        )
      );
    } finally {
      clearInterval(statusInterval);
      setIsProcessing(false);
      setCurrentStatus('');
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  if (repoLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1 flex flex-col justify-center items-center">
        <RotateCw className="h-10 w-10 text-blue-600 animate-spin" />
        <p className="text-gray-500 mt-2 text-sm">Loading chat environment...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row max-w-7xl mx-auto w-full h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/20 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-4">
          <Link 
            href={`/repository/${repoId}`}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </Link>
          <div className="pt-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-zinc-500">
              Active Repository
            </span>
            <h3 className="font-bold text-gray-800 dark:text-zinc-200 text-sm truncate mt-1">
              {repo?.owner}/{repo?.name}
            </h3>
            <span className="inline-block mt-1 text-[11px] font-semibold bg-blue-100 dark:bg-zinc-800 text-blue-700 dark:text-zinc-400 px-2 py-0.5 rounded font-mono">
              {repo?.language || 'Codebase'}
            </span>
          </div>

          <div className="border-t border-gray-200 dark:border-zinc-850 pt-3 space-y-2 text-xs text-gray-500 dark:text-zinc-400">
            <div className="flex justify-between">
              <span>Star Count:</span>
              <span className="font-semibold">{repo?.star_count}</span>
            </div>
            <div className="flex justify-between">
              <span>Fork Count:</span>
              <span className="font-semibold">{repo?.fork_count}</span>
            </div>
            <div className="flex justify-between">
              <span>File Count:</span>
              <span className="font-semibold">{repo?.file_count}</span>
            </div>
          </div>
        </div>

        <div className="hidden md:block text-[11px] text-gray-400 dark:text-zinc-600 border-t border-gray-200 dark:border-zinc-850 pt-3">
          Queries are limited to 1000 characters. Answers are verified using RAG chunk retrieval.
        </div>
      </div>

      {/* Main Chat Feed Area */}
      <div className="flex-1 flex flex-col bg-white dark:bg-zinc-950 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.length === 0 ? (
            /* Empty State */
            <div className="h-full flex flex-col justify-center items-center max-w-xl mx-auto text-center space-y-6">
              <div className="p-4 bg-blue-50 dark:bg-blue-950/10 rounded-full border border-blue-100 dark:border-blue-900/30">
                <Sparkles className="h-10 w-10 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-zinc-150">Ask questions about {repo?.name}</h2>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-2">
                  Query the architecture, look for specific implementations, or ask Gemini to explain folders. Every answer lists verified line citations.
                </p>
              </div>

              <div className="grid gap-2 w-full text-left">
                {[
                  'What is the primary structure of this repository?',
                  'Where is the main application logic or config defined?',
                  'Explain the main entry points of the codebase.'
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item)}
                    className="p-3 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-850 border border-gray-200 dark:border-zinc-850 text-sm font-medium text-gray-700 dark:text-zinc-300 rounded-xl transition-all cursor-pointer flex items-center justify-between"
                  >
                    <span>{item}</span>
                    <Send className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Chat feed */
            <div className="space-y-6">
              {messages.map((message) => (
                <div 
                  key={message.id}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-3xl rounded-2xl p-4 md:p-5 ${
                    message.sender === 'user' 
                      ? 'bg-blue-600 text-white rounded-tr-none'
                      : 'bg-gray-50 dark:bg-zinc-900/60 border border-gray-150 dark:border-zinc-850 rounded-tl-none text-gray-800 dark:text-zinc-100'
                  }`}>
                    {message.sender === 'user' && (
                      <p className="text-sm md:text-base leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
                    )}

                    {message.sender === 'assistant' && (
                      <div className="space-y-4">
                        {message.statusText && !message.response && !message.error && (
                          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400">
                            <RotateCw className="h-4 w-4 animate-spin text-blue-500" />
                            <span>{message.statusText}</span>
                          </div>
                        )}

                        {message.error && (
                          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/10 p-3 rounded-lg border border-red-200 dark:border-red-900/30">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{message.error}</span>
                          </div>
                        )}

                        {message.response && (
                          <>
                            <div className="bg-blue-50/50 dark:bg-blue-950/10 border-l-4 border-blue-600 dark:border-blue-500 p-3 rounded-r-xl">
                              <h4 className="text-xs uppercase font-extrabold text-blue-800 dark:text-blue-400 tracking-wider">
                                Direct Answer
                              </h4>
                              <p className="text-sm font-semibold text-gray-800 dark:text-zinc-250 mt-1">
                                {message.response.short_answer}
                              </p>
                            </div>

                            <div className="text-sm leading-relaxed prose dark:prose-invert">
                              <MarkdownViewer text={message.response.detailed_explanation} />
                            </div>

                            {message.response.code_snippets && message.response.code_snippets.length > 0 && (
                              <div className="space-y-3 pt-2">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                                  Referenced Code Snippets
                                </span>
                                {message.response.code_snippets.map((snippet, sIdx) => (
                                   <SnippetBox key={sIdx} snippet={snippet} repoUrl={repo?.github_url || ''} revision={repo?.commit_sha || 'HEAD'} />
                                ))}
                              </div>
                            )}

                            {message.response.citations && message.response.citations.length > 0 && (
                              <div className="pt-2 border-t border-gray-200 dark:border-zinc-800">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">
                                  Source Citations
                                </span>
                                <div className="flex flex-wrap gap-2">
                                  {message.response.citations.map((citation, cIdx) => {
                                    const revision = repo?.commit_sha || 'HEAD';
                                    const fileUrl = repo ? `${repo.github_url}/blob/${revision}/${citation.file_path}#L${citation.start_line}-L${citation.end_line}` : '#';
                                    return (
                                      <a
                                        key={cIdx}
                                        href={fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-750 dark:text-zinc-300 rounded-full border border-gray-200 dark:border-zinc-750/30 transition-all"
                                      >
                                        <Code className="h-3 w-3 text-blue-500" />
                                        <span>{citation.file_path} (L{citation.start_line}-{citation.end_line})</span>
                                        <ExternalLink className="h-2.5 w-2.5 text-gray-400" />
                                      </a>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {message.response.follow_up_suggestions && message.response.follow_up_suggestions.length > 0 && (
                              <div className="pt-3 border-t border-gray-200 dark:border-zinc-800 space-y-2">
                                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
                                  Follow-up suggestions
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {message.response.follow_up_suggestions.map((suggestion, sugIdx) => (
                                    <button
                                      key={sugIdx}
                                      onClick={() => handleSend(suggestion)}
                                      className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-zinc-750 rounded-xl transition-all text-left"
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar Area */}
        <div className="border-t border-gray-200 dark:border-zinc-800 p-4 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
          {isProcessing && (
            <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/10 px-3 py-2 rounded-xl mb-3 border border-blue-100/40 dark:border-blue-950/40 animate-pulse">
              <div className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 animate-spin" />
                <span>{currentStatus}</span>
              </div>
              <button 
                onClick={handleCancel}
                className="flex items-center gap-1 font-semibold text-red-600 dark:text-red-400 hover:underline shrink-0"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel query</span>
              </button>
            </div>
          )}

          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(query);
            }}
            className="flex items-end gap-3"
          >
            <div className="flex-1 relative bg-gray-50 dark:bg-zinc-900 border border-gray-300 dark:border-zinc-850 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value.substring(0, 1000))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(query);
                  }
                }}
                placeholder="Ask something about the codebase (e.g. 'How does routing work?', 'Explain db schemas')..."
                className="w-full bg-transparent resize-none outline-none border-none py-1.5 px-2 text-sm max-h-32 min-h-10 text-gray-800 dark:text-zinc-150 placeholder-gray-400 dark:placeholder-zinc-600"
                disabled={isProcessing}
                rows={2}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2 text-[10px] text-gray-400 dark:text-zinc-500 font-semibold select-none">
                <span>{query.length}/1000</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!query.trim() || isProcessing}
              className={`p-3.5 rounded-2xl text-white font-bold transition-all shadow-md active:scale-95 shrink-0 ${
                !query.trim() || isProcessing
                  ? 'bg-gray-300 dark:bg-zinc-800 text-gray-500 dark:text-zinc-600 cursor-not-allowed shadow-none'
                  : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700'
              }`}
              title="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function SnippetBox({ snippet, repoUrl, revision }: { snippet: CodeSnippet; repoUrl: string; revision?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code_content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const linesArr = snippet.lines.split('-');
  const startLine = parseInt(linesArr[0], 10) || 1;
  const endLine = parseInt(linesArr[1], 10) || 1;
  
  const githubFileUrl = repoUrl ? `${repoUrl}/blob/${revision || 'HEAD'}/${snippet.file_path}#L${startLine}-L${endLine}` : '#';

  return (
    <div className="border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-950">
      <div 
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800/80 cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 truncate">
          {collapsed ? <ChevronDown className="h-4 w-4 text-gray-500 shrink-0" /> : <ChevronUp className="h-4 w-4 text-gray-500 shrink-0" />}
          <span className="text-xs font-semibold font-mono text-gray-800 dark:text-zinc-200 truncate">
            {snippet.file_path}
          </span>
          <span className="text-[10px] bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 px-1.5 py-0.5 rounded font-mono shrink-0">
            Lines {snippet.lines}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={githubFileUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 hover:bg-gray-200 dark:hover:bg-zinc-850 rounded text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 transition-colors"
            title="Open on GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyCode();
            }}
            className="p-1 hover:bg-gray-200 dark:hover:bg-zinc-850 rounded text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 transition-colors flex items-center justify-center"
            title="Copy code content"
          >
            {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      
      {!collapsed && (
        <pre className="p-4 bg-gray-100/50 dark:bg-zinc-950 overflow-x-auto text-xs font-mono text-gray-800 dark:text-zinc-300 leading-relaxed border-t-0">
          <code>{snippet.code_content}</code>
        </pre>
      )}
    </div>
  );
}

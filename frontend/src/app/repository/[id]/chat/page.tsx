'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, RepoChatApiError } from '@/lib/api';
import { RepositoryResponse, ChatResponse, CodeSnippet, Citation } from '@/lib/types';
import { MarkdownViewer } from '@/components/MarkdownViewer';
import { getSuggestedQuestions } from '@/lib/repoIntelligence';
import {
  ArrowLeft,
  Send,
  AlertCircle,
  CheckCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Code,
  Sparkles,
  Trash2,
  XCircle,
  Menu,
  X,
  ArrowRight,
  FileCode,
  Star,
  GitFork,
  LayoutDashboard,
  User,
  ChevronRight,
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

const SUGGESTED_QUESTIONS = [
  'What does this project do?',
  'How is the repository structured?',
  'What dependencies does it use?',
  'What files are most important?',
];

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const dynamicQuestions = repo ? getSuggestedQuestions(repo) : SUGGESTED_QUESTIONS;

  // Load repo metadata and hydrate history
  useEffect(() => {
    const fetchMetadata = async () => {
      setRepoLoading(true);
      try {
        const data = await api.getRepositoryMetadata(repoId);
        setRepo(data);

        // Hydrate history from localStorage
        const savedHistory = localStorage.getItem(`repochat_history_${repoId}`);
        if (savedHistory) {
          try {
            setMessages(JSON.parse(savedHistory));
          } catch (e) {
            console.error('Failed to parse chat history', e);
          }
        }
      } catch (err: unknown) {
        console.error(err);
        // Clean up localStorage key for this repo if it exists
        try {
          localStorage.removeItem(`repochat_history_${repoId}`);
        } catch (e) {
          console.error(e);
        }
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

  // Handle initial query from URL search params (e.g. ?q=...)
  useEffect(() => {
    if (!repoLoading && repo && messages.length === 0) {
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get('q');
      if (initialQuery) {
        // Remove q parameter from URL state so it doesn't execute again on reload
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        handleSend(initialQuery);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoLoading, repo, messages.length]);

  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear the conversation history for this repository?")) {
      setMessages([]);
      try {
        localStorage.removeItem(`repochat_history_${repoId}`);
      } catch (e) {
        console.error('Failed to clear chat history', e);
      }
    }
  };

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isProcessing) return;

    const userMessageText = textToSend.trim().substring(0, 1000);
    setQuery('');
    setSidebarOpen(false);

    // Add user message
    const userMsgId = Math.random().toString(36).substring(7);
    const assistantMsgId = Math.random().toString(36).substring(7);

    const newUserMsg: ChatMessage = { id: userMsgId, sender: 'user', text: userMessageText };

    // Build context history from the current state (before appending the new message)
    const historyPayload = messages
      .filter(msg => !msg.error && (msg.text || msg.response))
      .map(msg => ({
        role: msg.sender,
        content: msg.sender === 'user'
          ? (msg.text || '')
          : (msg.response ? `${msg.response.short_answer}\n\n${msg.response.detailed_explanation}` : (msg.text || ''))
      }))
      .slice(-6);

    setMessages(prev => [
      ...prev,
      newUserMsg
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
      const chatRes = await api.chatAboutRepository(repoId, userMessageText, historyPayload, controller.signal);

      clearInterval(statusInterval);
      setMessages(prev => {
        const next = prev.map(msg =>
          msg.id === assistantMsgId
            ? { id: assistantMsgId, sender: 'assistant' as const, response: chatRes }
            : msg
        );
        try {
          localStorage.setItem(`repochat_history_${repoId}`, JSON.stringify(next));
        } catch (e) {
          console.error('Failed to save history to localStorage', e);
        }
        return next;
      });
    } catch (err: unknown) {
      clearInterval(statusInterval);
      let errorMsg = 'Failed to answer query. Connection error.';
      if (err instanceof Error && err.name === 'AbortError') {
        errorMsg = 'Query processing was cancelled.';
      } else if (err instanceof RepoChatApiError) {
        errorMsg = err.message;
      }

      setMessages(prev => {
        const next = prev.map(msg =>
          msg.id === assistantMsgId
            ? { id: assistantMsgId, sender: 'assistant' as const, error: errorMsg }
            : msg
        );
        try {
          localStorage.setItem(`repochat_history_${repoId}`, JSON.stringify(next));
        } catch (e) {
          console.error('Failed to save history to localStorage', e);
        }
        return next;
      });
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
      <div className="flex-1 flex h-[calc(100vh-4rem)] overflow-hidden animate-rc-fade-in">
        {/* Sidebar Skeleton */}
        <aside className="w-72 hidden md:flex flex-col shrink-0 bg-rc-bg-secondary border-r border-rc-border p-4 space-y-6">
          <div className="h-4 w-20 rc-skeleton rounded" />
          <div className="h-32 w-full rc-skeleton rounded-rc-xl" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-14 rc-skeleton rounded-lg" />
            <div className="h-14 rc-skeleton rounded-lg" />
            <div className="h-14 rc-skeleton rounded-lg" />
          </div>
          <div className="space-y-2.5">
            <div className="h-3 w-16 rc-skeleton rounded" />
            <div className="h-8 w-full rc-skeleton rounded-lg" />
            <div className="h-8 w-full rc-skeleton rounded-lg" />
            <div className="h-8 w-full rc-skeleton rounded-lg" />
          </div>
        </aside>
        {/* Chat Feed Skeleton */}
        <main className="flex-1 flex flex-col p-6 space-y-6 bg-rc-bg">
          <div className="flex justify-between items-center pb-4 border-b border-rc-border">
            <div className="h-6 w-40 rc-skeleton rounded" />
          </div>
          <div className="flex-1 flex flex-col justify-center items-center space-y-4 max-w-lg mx-auto w-full text-center">
            <div className="w-16 h-16 rounded-2xl rc-skeleton" />
            <div className="h-6 w-64 rc-skeleton rounded" />
            <div className="h-4 w-full rc-skeleton rounded" />
            <div className="h-4 w-4/5 rc-skeleton rounded" />
            <div className="grid grid-cols-2 gap-3 w-full pt-4">
              <div className="h-14 rc-skeleton rounded-xl" />
              <div className="h-14 rc-skeleton rounded-xl" />
              <div className="h-14 rc-skeleton rounded-xl" />
              <div className="h-14 rc-skeleton rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 md:hidden animate-rc-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 md:static md:z-auto
          w-72 flex flex-col shrink-0
          bg-rc-bg-secondary border-r border-rc-border
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between p-4 border-b border-rc-border">
          <Link
            href={`/repository/${repoId}`}
            className="flex items-center gap-1.5 text-xs font-semibold text-rc-foreground-muted hover:text-rc-primary transition-all duration-rc-base hover:-translate-x-0.5 focus:outline-none rc-focus-ring rounded px-1.5"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-rc-lg hover:bg-rc-secondary-hover active:scale-95 transition-all duration-rc-base focus:outline-none rc-focus-ring"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4 text-rc-foreground-muted" />
          </button>
        </div>

        {/* Sidebar scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Repository context card */}
          <div className="rounded-rc-xl border border-rc-border bg-rc-card overflow-hidden shadow-rc-sm">
            <div className="h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500" />
            <div className="p-3.5 space-y-2.5">
              <div>
                <p className="rc-text-overline">Repository</p>
                <h3 className="font-semibold text-sm text-rc-foreground truncate mt-0.5">
                  {repo?.owner}/{repo?.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-rc-primary-muted text-rc-primary px-2 py-0.5 rounded-rc-pill">
                  <Code className="h-3 w-3" />
                  {repo?.language || 'Multi'}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-rc-success-muted text-rc-success px-2 py-0.5 rounded-rc-pill">
                  Ready
                </span>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="flex flex-col items-center p-2.5 rounded-rc-lg bg-rc-card border border-rc-border hover:border-rc-primary/20 transition-colors">
              <Star className="h-3.5 w-3.5 text-amber-500 mb-1 animate-pulse" />
              <span className="text-sm font-extrabold text-rc-foreground">{repo?.star_count ?? 0}</span>
              <span className="text-[10px] text-rc-foreground-muted font-medium">Stars</span>
            </div>
            <div className="flex flex-col items-center p-2.5 rounded-rc-lg bg-rc-card border border-rc-border hover:border-rc-primary/20 transition-colors">
              <GitFork className="h-3.5 w-3.5 text-rc-accent mb-1" />
              <span className="text-sm font-extrabold text-rc-foreground">{repo?.fork_count ?? 0}</span>
              <span className="text-[10px] text-rc-foreground-muted font-medium">Forks</span>
            </div>
            <div className="flex flex-col items-center p-2.5 rounded-rc-lg bg-rc-card border border-rc-border hover:border-rc-primary/20 transition-colors">
              <FileCode className="h-3.5 w-3.5 text-rc-success mb-1" />
              <span className="text-sm font-extrabold text-rc-foreground">{repo?.file_count ?? 0}</span>
              <span className="text-[10px] text-rc-foreground-muted font-medium">Files</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-1.5">
            <p className="rc-text-overline px-1">Quick Actions</p>
            <Link
              href={`/repository/${repoId}`}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover rounded-rc-lg transition-all duration-rc-base active:scale-98 focus:outline-none rc-focus-ring"
              aria-label="Open repository dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
            {repo?.github_url && (
              <a
                href={repo.github_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover rounded-rc-lg transition-all duration-rc-base active:scale-98 focus:outline-none rc-focus-ring"
                aria-label="Open GitHub page in new window"
              >
                <ExternalLink className="h-4 w-4" />
                <span>GitHub</span>
              </a>
            )}
            {messages.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-rc-destructive bg-rc-destructive-muted/10 hover:bg-rc-destructive-muted/30 border border-rc-destructive-muted/20 rounded-rc-lg transition-all duration-rc-base active:scale-98 focus:outline-none rc-focus-ring"
                aria-label="Clear chat history for this repository"
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear History</span>
              </button>
            )}
          </div>

          {/* Suggested questions — always visible */}
          <div className="space-y-1.5">
            <p className="rc-text-overline px-1">Suggested Questions</p>
            <div className="space-y-0.5">
              {dynamicQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(q)}
                  disabled={isProcessing}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-xs text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover rounded-rc-lg transition-all duration-rc-base hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed group focus:outline-none rc-focus-ring"
                  aria-label={`Ask suggested question: ${q}`}
                >
                  <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rc-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="leading-relaxed">{q}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar footer */}
        <div className="hidden md:block p-3 border-t border-rc-border">
          <p className="text-[10px] text-rc-foreground-muted leading-relaxed text-center font-medium">
            RAG-powered answers · 1000 char limit
          </p>
        </div>
      </aside>

      {/* ─── Main Chat Area ─── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-rc-bg">
        {/* Mobile header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-rc-border md:hidden bg-rc-bg">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-rc-lg hover:bg-rc-secondary-hover transition-colors focus:outline-none rc-focus-ring"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5 text-rc-foreground-secondary" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-rc-foreground truncate">
              {repo?.owner}/{repo?.name}
            </h3>
          </div>
        </div>

        {/* Chat feed */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            /* ─── Empty State ─── */
            <div className="h-full flex flex-col justify-center items-center px-4 py-8">
              <div className="max-w-lg w-full text-center space-y-6 animate-rc-slide-up duration-rc-slow">
                {/* Icon */}
                <div className="mx-auto w-16 h-16 rounded-2xl bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center animate-rc-pulse-glow hover:scale-105 transition-transform">
                  <Sparkles className="h-8 w-8 text-rc-primary" />
                </div>

                {/* Title */}
                <div className="space-y-2">
                  <h2 className="rc-text-section-title text-rc-foreground font-bold">
                    Ask anything about{' '}
                    <span className="text-rc-primary">{repo?.name}</span>
                  </h2>
                  <p className="rc-text-caption max-w-md mx-auto leading-relaxed">
                    Explore the architecture, dependencies, implementation details, and code structure.
                    Every answer includes verified source citations.
                  </p>
                </div>

                {/* Suggestion cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {dynamicQuestions.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(item)}
                      className="group flex items-start gap-3 p-3.5 rounded-rc-xl border border-rc-border bg-rc-card hover:bg-rc-card-hover hover:border-rc-primary/45 hover:shadow-rc-sm hover:scale-[1.01] active:scale-[0.99] transition-all duration-rc-base text-left focus:outline-none rc-focus-ring"
                      aria-label={`Select suggested question ${item}`}
                    >
                      <ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-rc-primary opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                      <span className="text-sm text-rc-foreground-secondary group-hover:text-rc-foreground transition-colors leading-relaxed font-medium">
                        {item}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ─── Chat Messages ─── */
            <div>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`py-6 px-4 md:px-8 border-b border-rc-border-subtle animate-rc-slide-up duration-rc-base ${
                    message.sender === 'assistant' ? 'bg-rc-bg-secondary/40 border-b border-rc-border/10' : ''
                  }`}
                >
                  <div className="max-w-3xl mx-auto">
                    {/* Sender identity */}
                    <div className="flex items-center gap-2.5 mb-3">
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                          message.sender === 'user'
                            ? 'bg-rc-primary-muted text-rc-primary border border-rc-primary/20'
                            : 'bg-rc-accent-muted text-rc-accent border border-rc-accent/20'
                        }`}
                      >
                        {message.sender === 'user'
                          ? <User className="h-3.5 w-3.5" />
                          : <Sparkles className="h-3.5 w-3.5 animate-pulse" />}
                      </div>
                      <span className="text-sm font-bold text-rc-foreground">
                        {message.sender === 'user' ? 'You' : 'RepoChat'}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="pl-[38px]">
                      {/* User message text */}
                      {message.sender === 'user' && (
                        <p className="rc-text-body text-rc-foreground break-words whitespace-pre-wrap leading-relaxed">
                          {message.text}
                        </p>
                      )}

                      {/* Assistant content */}
                      {message.sender === 'assistant' && (
                        <div className="space-y-5">
                          {/* Loading / typing indicator */}
                          {message.statusText && !message.response && !message.error && (
                            <div className="flex items-center gap-2.5">
                              <div className="flex gap-1 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-rc-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-rc-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-rc-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                              </div>
                              <span className="text-sm text-rc-foreground-muted font-medium">{message.statusText}</span>
                            </div>
                          )}

                          {/* Error state */}
                          {message.error && (
                            <div className="flex items-start gap-2.5 p-3.5 rounded-rc-xl bg-rc-destructive-muted/10 border border-rc-destructive-muted/20 animate-rc-slide-down">
                              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rc-destructive" />
                              <span className="text-sm text-rc-destructive font-medium">{message.error}</span>
                            </div>
                          )}

                          {/* Full response */}
                          {message.response && (
                            <>
                              {/* Section 1: Direct Answer */}
                              <div className="p-4 rounded-rc-xl bg-rc-primary-muted/10 border border-rc-primary/20 shadow-rc-xs animate-rc-slide-up">
                                <p className="rc-text-overline text-rc-primary mb-1.5">
                                  Direct Answer
                                </p>
                                <p className="text-sm font-semibold text-rc-foreground leading-relaxed">
                                  {message.response.short_answer}
                                </p>
                              </div>

                              {/* Section 2: Detailed Explanation */}
                              {message.response.detailed_explanation && (
                                <div className="prose dark:prose-invert max-w-none text-sm text-rc-foreground-secondary leading-relaxed animate-rc-slide-up [animation-delay:100ms]">
                                  <MarkdownViewer text={message.response.detailed_explanation} />
                                </div>
                              )}

                              {/* Section 3: Code Snippets */}
                              {message.response.code_snippets && message.response.code_snippets.length > 0 && (
                                <div className="space-y-3 animate-rc-slide-up [animation-delay:200ms]">
                                  <p className="rc-text-overline flex items-center gap-1.5">
                                    <Code className="h-3.5 w-3.5" />
                                    Referenced Code ({message.response.code_snippets.length})
                                  </p>
                                  {message.response.code_snippets.map((snippet, sIdx) => (
                                    <SnippetBox
                                      key={sIdx}
                                      snippet={snippet}
                                      repoUrl={repo?.github_url || ''}
                                      revision={repo?.commit_sha || 'HEAD'}
                                      defaultExpanded={sIdx === 0}
                                    />
                                  ))}
                                </div>
                              )}

                              {/* Section 4: Source Citations */}
                              {message.response.citations && message.response.citations.length > 0 && (
                                <div className="space-y-2.5 animate-rc-slide-up [animation-delay:300ms]">
                                  <p className="rc-text-overline flex items-center gap-1.5">
                                    <FileCode className="h-3.5 w-3.5" />
                                    Source Citations ({message.response.citations.length})
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {message.response.citations.map((citation, cIdx) => {
                                      const revision = repo?.commit_sha || 'HEAD';
                                      const fileUrl = repo
                                        ? `${repo.github_url}/blob/${revision}/${citation.file_path}#L${citation.start_line}-L${citation.end_line}`
                                        : '#';
                                      const fileName = citation.file_path.split('/').pop() || citation.file_path;
                                      const dirPath = citation.file_path.includes('/')
                                        ? citation.file_path.substring(0, citation.file_path.lastIndexOf('/'))
                                        : '';
                                      return (
                                        <a
                                          key={cIdx}
                                          href={fileUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="group flex items-center gap-3 p-3 rounded-rc-xl border border-rc-border hover:border-rc-primary/45 bg-rc-card hover:bg-rc-card-hover hover:scale-[1.01] active:scale-[0.99] hover:shadow-rc-sm transition-all duration-rc-base focus:outline-none rc-focus-ring"
                                          aria-label={`View citation for file ${fileName} lines ${citation.start_line} to ${citation.end_line}`}
                                        >
                                          <div className="h-8 w-8 rounded-rc-md bg-rc-bg-secondary flex items-center justify-center shrink-0 group-hover:bg-rc-primary-muted transition-colors duration-rc-base">
                                            <FileCode className="h-4 w-4 text-rc-foreground-muted group-hover:text-rc-primary transition-colors duration-rc-base" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-rc-foreground truncate">
                                              {fileName}
                                            </p>
                                            <p className="text-[10px] text-rc-foreground-muted truncate">
                                              {dirPath && <span>{dirPath} · </span>}
                                              L{citation.start_line}–{citation.end_line}
                                            </p>
                                          </div>
                                          <ExternalLink className="h-3.5 w-3.5 text-rc-foreground-muted group-hover:text-rc-primary shrink-0 transition-colors duration-rc-base" />
                                        </a>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Section 5: Follow-up Suggestions */}
                              {message.response.follow_up_suggestions && message.response.follow_up_suggestions.length > 0 && (
                                <div className="space-y-2.5 pt-1 animate-rc-slide-up [animation-delay:400ms]">
                                  <p className="rc-text-overline flex items-center gap-1.5">
                                    <Sparkles className="h-3.5 w-3.5 text-rc-primary" />
                                    Continue Exploring
                                  </p>
                                  <div className="flex flex-col gap-1.5">
                                    {message.response.follow_up_suggestions.map((suggestion, sugIdx) => (
                                      <button
                                        key={sugIdx}
                                        onClick={() => handleSend(suggestion)}
                                        disabled={isProcessing}
                                        className="group flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left text-rc-foreground-secondary hover:text-rc-foreground bg-rc-card hover:bg-rc-card-hover border border-rc-border hover:border-rc-primary/45 rounded-rc-xl transition-all duration-rc-base hover:scale-[1.01] active:scale-[0.99] focus:outline-none rc-focus-ring"
                                        aria-label={`Ask suggestion: ${suggestion}`}
                                      >
                                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-rc-primary opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                        <span>{suggestion}</span>
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
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ─── Input Area ─── */}
        <div className="border-t border-rc-border p-3 md:p-4 bg-rc-bg">
          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center justify-between px-3 py-2 mb-3 rounded-rc-xl bg-rc-primary-muted border border-rc-primary/20 animate-rc-pulse-glow">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-rc-primary border-t-transparent animate-spin" />
                <span className="text-xs font-semibold text-rc-primary">{currentStatus}</span>
              </div>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 text-xs font-bold text-rc-destructive hover:opacity-85 transition-opacity focus:outline-none rc-focus-ring rounded px-1"
                aria-label="Cancel query processing"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(query);
            }}
            className="flex items-end gap-2.5"
          >
            <div className="flex-1 relative rounded-rc-xl border border-rc-border bg-rc-card shadow-rc-xs focus-within:border-rc-primary focus-within:ring-2 focus-within:ring-rc-primary/15 transition-all">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value.substring(0, 1000))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(query);
                  }
                }}
                placeholder={`Ask about ${repo?.name || 'this repository'}...`}
                className="w-full bg-transparent resize-none outline-none border-none py-3 px-4 text-sm text-rc-foreground placeholder:text-rc-foreground-muted min-h-[44px] max-h-32 focus:ring-0"
                disabled={isProcessing}
                rows={1}
                aria-label="Chat message query query"
              />
              {query.length > 0 && (
                <div className="absolute right-3 bottom-2 pointer-events-none select-none">
                  <span className={`text-[10px] font-bold ${
                    query.length > 900
                      ? 'text-rc-warning'
                      : 'text-rc-foreground-muted'
                  }`}>
                    {query.length}/1000
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!query.trim() || isProcessing}
              className={`p-3 rounded-rc-xl transition-all duration-rc-base shrink-0 focus:outline-none rc-focus-ring ${
                !query.trim() || isProcessing
                  ? 'bg-rc-muted text-rc-foreground-muted cursor-not-allowed border border-transparent'
                  : 'bg-rc-primary hover:bg-rc-primary-hover text-white shadow-rc-sm hover:shadow-rc-md hover:scale-105 active:scale-95'
              }`}
              title="Send message"
              aria-label="Send message query"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─── Code Snippet Component ─── */
function SnippetBox({
  snippet,
  repoUrl,
  revision,
  defaultExpanded = false,
}: {
  snippet: CodeSnippet;
  repoUrl: string;
  revision?: string;
  defaultExpanded?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
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

  const githubFileUrl = repoUrl
    ? `${repoUrl}/blob/${revision || 'HEAD'}/${snippet.file_path}#L${startLine}-L${endLine}`
    : '#';
  const fileName = snippet.file_path.split('/').pop() || snippet.file_path;

  return (
    <div className="rounded-rc-xl border border-rc-border overflow-hidden bg-rc-card shadow-rc-xs transition-all duration-rc-base">
      {/* Snippet header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-3.5 py-2.5 bg-rc-bg-secondary cursor-pointer select-none hover:bg-rc-secondary-hover transition-colors focus-within:ring-1 focus-within:ring-rc-primary"
      >
        <div className="flex items-center gap-2 min-w-0">
          <button 
            className="p-1 rounded hover:bg-rc-secondary focus:outline-none rc-focus-ring" 
            aria-label={collapsed ? "Expand code snippet" : "Collapse code snippet"}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
          >
            {collapsed
              ? <ChevronDown className="h-4 w-4 text-rc-foreground-muted shrink-0" />
              : <ChevronUp className="h-4 w-4 text-rc-foreground-muted shrink-0" />}
          </button>
          <FileCode className="h-3.5 w-3.5 text-rc-primary shrink-0" />
          <span className="text-xs font-semibold text-rc-foreground truncate font-mono">
            {fileName}
          </span>
          <span className="text-[10px] text-rc-foreground-muted bg-rc-muted px-1.5 py-0.5 rounded font-mono shrink-0 border border-rc-border/50">
            L{snippet.lines}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <a
            href={githubFileUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-rc-md hover:bg-rc-secondary-hover text-rc-foreground-muted hover:text-rc-foreground transition-all duration-rc-fast active:scale-90 focus:outline-none rc-focus-ring"
            title="View on GitHub"
            aria-label="View source code on GitHub (opens in new tab)"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyCode();
            }}
            className="p-1.5 rounded-rc-md hover:bg-rc-secondary-hover text-rc-foreground-muted hover:text-rc-foreground transition-all duration-rc-fast active:scale-90 focus:outline-none rc-focus-ring"
            title="Copy code"
            aria-label="Copy code snippet to clipboard"
          >
            {copied
              ? <CheckCircle className="h-3.5 w-3.5 text-rc-success animate-rc-fade-in" />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Code content */}
      {!collapsed && (
        <pre className="p-4 overflow-x-auto text-xs font-mono leading-relaxed text-rc-foreground-secondary bg-rc-bg-secondary/40 border-t border-rc-border/40 animate-rc-slide-down">
          <code>{snippet.code_content}</code>
        </pre>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, RepoChatApiError } from '@/lib/api';
import { RepositoryResponse } from '@/lib/types';
import { MarkdownViewer } from '@/components/MarkdownViewer';
import { 
  Star, 
  GitFork, 
  FileText, 
  Database, 
  MessageSquare, 
  ArrowLeft, 
  RotateCw, 
  AlertCircle, 
  Layers, 
  Calendar,
  ExternalLink,
  Code2,
  FileCode,
  Sparkles,
  Terminal,
  Cpu,
  Clock,
  BookOpen,
  ChevronRight,
  Activity,
  Settings
} from 'lucide-react';
import { parseRepositorySnapshot, getSuggestedQuestions } from '@/lib/repoIntelligence';

interface PageProps {
  params: {
    id: string;
  };
}

function getFriendlyIngestionErrorMessage(rawError?: string | null): string {
  if (!rawError) {
    return 'No specific details provided by the indexing worker.';
  }
  const lower = rawError.toLowerCase();
  if (lower.includes('quota') || lower.includes('limit') || lower.includes('exhausted') || lower.includes('429')) {
    return 'The public Gemini API rate limit or quota has been reached. Please try again in a few minutes, or run RepoChat locally using your own API key.';
  }
  if (lower.includes('lock already held')) {
    return 'This repository is currently being indexed by another worker. Please wait for that process to complete.';
  }
  if (lower.includes('clone') || lower.includes('git') || lower.includes('exit code 128')) {
    return 'Failed to clone repository. Please verify that the repository is public and the URL is correct.';
  }
  if (lower.includes('no indexable code files')) {
    return 'No supported source files (such as .py, .js, .ts, .go) were found in the repository.';
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return 'The indexing operation timed out. The repository might be too large for the public server resources.';
  }
  return 'An unexpected error occurred during the indexing pipeline. Please verify the repository and retry.';
}

export default function RepositoryDashboard({ params }: PageProps) {
  const router = useRouter();
  const repoId = parseInt(params.id, 10);
  
  const [repo, setRepo] = useState<RepositoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'summary' | 'architecture'>('summary');
  const [isReingesting, setIsReingesting] = useState(false);
  const [reingestUrl, setReingestUrl] = useState('');

  useEffect(() => {
    // Attempt to find URL in localStorage recent list in case of expiration/reingestion needs
    try {
      const saved = localStorage.getItem('recent_repos');
      if (saved) {
        const list: RepositoryResponse[] = JSON.parse(saved);
        const match = list.find(r => r.id === repoId);
        if (match) {
          setReingestUrl(match.github_url);
        }
      }
    } catch (e) {
      console.error(e);
    }

    let active = true;
    let timer: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (!repoId || isNaN(repoId)) return;
      try {
        const data = await api.getRepositoryMetadata(repoId);
        if (!active) return;
        setRepo(data);
        setErrorStatus(null);
        setErrorMessage(null);
        
        // If status is PENDING or PROCESSING, continue polling
        if (data.status === 'PENDING' || data.status === 'PROCESSING') {
          timer = setTimeout(poll, 3000);
        }
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof RepoChatApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Could not connect to the backend API.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [repoId]);

  useEffect(() => {
    if (repo && !reingestUrl) {
      setReingestUrl(repo.github_url);
    }
  }, [repo, reingestUrl]);

  const handleReingest = async () => {
    if (!reingestUrl) {
      router.push('/');
      return;
    }
    
    setIsReingesting(true);
    setErrorStatus(null);
    setErrorMessage(null);
    try {
      const newRepo = await api.ingestRepository(reingestUrl);
      
      // Update history in localStorage
      try {
        const saved = localStorage.getItem('recent_repos');
        let list: RepositoryResponse[] = saved ? JSON.parse(saved) : [];
        list = [newRepo, ...list.filter(r => r.id !== repoId && r.github_url !== reingestUrl)].slice(0, 5);
        localStorage.setItem('recent_repos', JSON.stringify(list));
      } catch (e) {
        console.error(e);
      }

      if (newRepo.id !== repoId) {
        router.push(`/repository/${newRepo.id}`);
      } else {
        setRepo(newRepo);
        setIsReingesting(false);
      }
    } catch (err: unknown) {
      if (err instanceof RepoChatApiError) {
        setErrorStatus(err.status);
        setErrorMessage(`Re-ingestion failed: ${err.message}`);
      } else {
        setErrorMessage('Re-ingestion failed: Connection error.');
      }
      setIsReingesting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex-1 flex flex-col gap-8 animate-rc-fade-in">
        {/* Hero Skeleton */}
        <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-sm space-y-4">
          <div className="h-4 w-24 rc-skeleton rounded" />
          <div className="h-8 w-2/3 rc-skeleton rounded" />
          <div className="flex gap-2">
            <div className="h-6 w-20 rc-skeleton rounded-pill" />
            <div className="h-6 w-24 rc-skeleton rounded-pill" />
          </div>
        </div>

        {/* Snapshot Skeleton */}
        <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-sm space-y-6">
          <div className="h-6 w-48 rc-skeleton rounded" />
          <div className="h-20 w-full rc-skeleton rounded-rc-xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-16 rc-skeleton rounded-rc-xl" />
            <div className="h-16 rc-skeleton rounded-rc-xl" />
            <div className="h-16 rc-skeleton rounded-rc-xl" />
          </div>
        </div>

        {/* Insights Skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-rc-card border border-rc-border rounded-rc-xl p-4 space-y-2 animate-rc-pulse-glow">
              <div className="h-3 w-12 rc-skeleton rounded" />
              <div className="h-6 w-16 rc-skeleton rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Handle Expired Cache (410 GONE)
  if (errorStatus === 410) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 flex-1 flex flex-col justify-center text-center animate-rc-fade-in">
        <div className="bg-rc-card border border-rc-border p-8 rounded-rc-2xl shadow-rc-md flex flex-col items-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rc-warning" />
          
          <div className="w-16 h-16 rounded-rc-pill bg-rc-warning/10 flex items-center justify-center text-rc-warning mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          
          <h2 className="text-2xl font-bold text-rc-foreground tracking-tight">Repository Cache Expired</h2>
          <p className="mt-3 text-sm text-rc-foreground-secondary leading-relaxed max-w-sm">
            To optimize resources, indexed repository caches are purged after 24 hours. Re-index this codebase below to query it with the AI Assistant.
          </p>

          <div className="mt-6 w-full space-y-3">
            {isReingesting ? (
              <div className="flex flex-col items-center gap-3 py-3 bg-rc-bg-secondary rounded-rc-xl border border-rc-border">
                <RotateCw className="h-6 w-6 text-rc-primary animate-spin" />
                <span className="text-xs text-rc-foreground-muted">Re-indexing repository...</span>
              </div>
            ) : (
              <>
                <button
                  onClick={handleReingest}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-bold text-white bg-rc-primary hover:bg-rc-primary-hover rounded-rc-xl transition-all shadow-rc-sm hover:scale-[1.01] active:scale-95"
                >
                  <RotateCw className="h-4 w-4" />
                  <span>Re-index Repository Now</span>
                </button>
                <Link
                  href="/"
                  className="w-full block text-center px-5 py-3.5 text-xs font-semibold text-rc-foreground-secondary bg-rc-bg-secondary border border-rc-border hover:bg-rc-muted rounded-rc-xl transition-all hover:scale-[1.01] active:scale-95"
                >
                  Go Back to Homepage
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Handle Missing Repository (404 NOT FOUND) or general errors
  if (errorStatus === 404 || !repo) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 flex-1 flex flex-col justify-center text-center animate-rc-fade-in">
        <div className="bg-rc-card border border-rc-border p-8 rounded-rc-2xl shadow-rc-md flex flex-col items-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rc-destructive" />
          
          <div className="w-16 h-16 rounded-rc-pill bg-rc-destructive/10 flex items-center justify-center text-rc-destructive mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          
          <h2 className="text-2xl font-bold text-rc-foreground tracking-tight">Repository Not Found</h2>
          <p className="mt-3 text-sm text-rc-foreground-secondary leading-relaxed max-w-sm">
            {errorMessage || 'The requested repository could not be located in cache. It may have expired or was never indexed.'}
          </p>
          <Link
            href="/"
            className="mt-6 flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-bold text-white bg-rc-primary hover:bg-rc-primary-hover rounded-rc-xl transition-all shadow-rc-sm hover:scale-[1.01] active:scale-95 w-full"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Go to homepage</span>
          </Link>
        </div>
      </div>
    );
  }

  const sizeInMB = (repo.total_size_bytes / (1024 * 1024)).toFixed(2);
  const snapshot = repo && repo.status === 'COMPLETED' ? parseRepositorySnapshot(repo) : null;
  const suggestedQuestions = repo && repo.status === 'COMPLETED' ? getSuggestedQuestions(repo) : [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex-1 flex flex-col gap-8 animate-rc-fade-in">
      {/* 1. Repository Hero */}
      <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-sm hover:shadow-rc-md transition-all duration-rc-base relative overflow-hidden group animate-rc-slide-up">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 animate-rc-pulse-glow" />
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-3 flex-1 min-w-0">
            <Link 
              href="/" 
              className="inline-flex items-center gap-1.5 text-xs text-rc-foreground-muted hover:text-rc-primary transition-all duration-rc-base hover:-translate-x-0.5 font-medium focus:outline-none rc-focus-ring rounded px-1"
              aria-label="Back to landing page"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Ingestion</span>
            </Link>
            
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight break-all">
                {repo.owner}/{repo.name}
              </h1>
              <a 
                href={repo.github_url} 
                target="_blank" 
                rel="noreferrer" 
                className="text-rc-foreground-muted hover:text-rc-foreground transition-all duration-rc-base p-1.5 rounded-rc-md hover:bg-rc-secondary-hover active:scale-95 focus:outline-none rc-focus-ring"
                title="Open GitHub repository"
                aria-label="View repository on GitHub (opens in new tab)"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
            </div>
            
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-rc-pill bg-rc-primary-muted text-rc-primary font-semibold border border-rc-primary/20">
                <Code2 className="h-3 w-3" />
                {repo.language || 'Multiple'}
              </span>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-rc-pill bg-rc-success-muted text-rc-success font-semibold border border-rc-success/20">
                <span className="h-1.5 w-1.5 rounded-full bg-rc-success animate-pulse" />
                {repo.status}
              </span>
              <div className="h-3 w-px bg-rc-border hidden sm:block" />
              <span className="flex items-center gap-1 text-rc-foreground-secondary font-medium">
                <FileCode className="h-3.5 w-3.5 text-rc-success" />
                <span>{repo.file_count} files</span>
              </span>
              <span className="flex items-center gap-1 text-rc-foreground-secondary font-medium">
                <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 animate-pulse" />
                <span>{repo.star_count} stars</span>
              </span>
              <span className="flex items-center gap-1 text-rc-foreground-secondary font-medium">
                <GitFork className="h-3.5 w-3.5 text-rc-accent" />
                <span>{repo.fork_count} forks</span>
              </span>
            </div>

            {repo.status === 'COMPLETED' && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-rc-foreground-muted">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  Indexed {new Date(repo.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-rc-border">•</span>
                <span>
                  Cache expires {new Date(repo.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto self-stretch md:self-auto justify-end md:items-center">
            {repo.status === 'COMPLETED' && (
              <button
                onClick={handleReingest}
                disabled={isReingesting}
                className="flex items-center justify-center gap-2 px-5 py-3.5 bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary hover:text-rc-foreground hover:bg-rc-secondary-hover font-bold rounded-rc-xl transition-all duration-rc-base hover:scale-[1.01] active:scale-95 shrink-0 w-full sm:w-auto text-center disabled:opacity-50 focus:outline-none rc-focus-ring"
                aria-label="Reanalyze repository"
              >
                <RotateCw className={`h-4 w-4 ${isReingesting ? 'animate-spin' : ''}`} />
                <span>{isReingesting ? 'Re-analyzing...' : 'Reanalyze'}</span>
              </button>
            )}

            {repo.status === 'COMPLETED' ? (
              <Link
                href={`/repository/${repo.id}/chat`}
                className="flex items-center justify-center gap-2 px-6 py-3.5 bg-rc-primary hover:bg-rc-primary-hover text-white font-bold rounded-rc-xl transition-all duration-rc-base shadow-rc-md hover:shadow-rc-lg hover:scale-[1.01] active:scale-95 shrink-0 w-full sm:w-auto text-center focus:outline-none rc-focus-ring"
                aria-label="Start chatting with AI assistant"
              >
                <MessageSquare className="h-5 w-5" />
                <span>Start Chatting</span>
              </Link>
            ) : (
              <button
                disabled
                className="flex items-center justify-center gap-2 px-6 py-3.5 bg-rc-muted border border-rc-border text-rc-foreground-muted font-bold rounded-rc-xl transition-all cursor-not-allowed shrink-0 w-full sm:w-auto"
                aria-label="Chat disabled during indexing"
              >
                <MessageSquare className="h-5 w-5 animate-pulse" />
                <span>Chat Disabled ({repo.status})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {repo.status === 'PENDING' || repo.status === 'PROCESSING' ? (
        <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-12 shadow-rc-sm flex-1 flex flex-col justify-center items-center text-center max-w-xl mx-auto w-full my-8 animate-rc-slide-up duration-rc-slow">
          <RotateCw className="h-12 w-12 text-rc-primary animate-spin mb-4" />
          <h3 className="text-lg font-bold text-rc-foreground">
            {repo.status === 'PENDING' ? 'Ingestion Queued' : 'Ingestion Processing'}
          </h3>
          <p className="text-sm text-rc-foreground-muted mt-2 leading-relaxed">
            {repo.status === 'PENDING' 
              ? 'Repository ingestion task is queued in our memory buffer and waiting to be processed by our background worker.' 
              : 'Our background worker is currently cloning, parsing, embedding, and indexing your repository code chunks.'}
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs font-semibold bg-rc-primary-muted text-rc-primary px-3 py-1.5 rounded-rc-lg border border-rc-primary/25 animate-pulse">
            <span>Status: {repo.status} (polling for updates...)</span>
          </div>
        </div>
      ) : repo.status === 'FAILED' ? (
        <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-8 shadow-rc-sm flex-1 flex flex-col justify-center items-center text-center max-w-xl mx-auto w-full my-8 relative overflow-hidden animate-rc-slide-up duration-rc-slow">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rc-destructive" />
          <AlertCircle className="h-16 w-16 text-rc-destructive mb-4 animate-bounce" />
          <h3 className="text-lg font-bold text-rc-foreground">Ingestion Pipeline Failed</h3>
          <p className="text-sm text-rc-foreground-muted mt-2 leading-relaxed max-w-md">
            {getFriendlyIngestionErrorMessage(repo.error_message)}
          </p>
          <div className="w-full mt-6 text-left">
            <details className="group bg-rc-bg-secondary border border-rc-border-subtle rounded-rc-xl overflow-hidden focus-within:ring-2 focus-within:ring-rc-primary focus-within:outline-none">
              <summary className="flex items-center justify-between p-3 text-xs font-semibold text-rc-foreground-secondary cursor-pointer hover:bg-rc-secondary-hover select-none focus:outline-none" aria-label="View error traceback">
                <span>View technical details for developers</span>
                <span className="transition-transform group-open:rotate-180 text-rc-foreground-muted">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <div className="p-4 border-t border-rc-border bg-rc-bg-tertiary font-mono text-xs text-rc-foreground-muted max-h-48 overflow-y-auto break-all whitespace-pre-wrap">
                {repo.error_message || 'No raw traceback logs available.'}
              </div>
            </details>
          </div>
          <div className="mt-6 w-full space-y-3">
            {isReingesting ? (
              <div className="flex flex-col items-center gap-3 py-3 bg-rc-bg-secondary rounded-rc-xl border border-rc-border">
                <RotateCw className="h-6 w-6 text-rc-primary animate-spin" />
                <span className="text-xs text-rc-foreground-muted">Restarting ingestion pipeline...</span>
              </div>
            ) : (
              <button
                onClick={handleReingest}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-base font-semibold text-white bg-rc-primary hover:bg-rc-primary-hover rounded-rc-xl transition-all duration-rc-base active:scale-95 shadow-rc-sm focus:outline-none rc-focus-ring"
                aria-label="Retry repository ingestion"
              >
                <RotateCw className="h-4 w-4" />
                <span>Retry Ingestion Workflow</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* 3. Key Insights */}
          {snapshot && (
            <div className="space-y-4 animate-rc-slide-up duration-rc-slow [animation-delay:100ms]">
              <h3 className="rc-text-section-title text-rc-foreground pl-1 font-bold">Key Insights</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-rc-success-muted flex items-center justify-center text-rc-success group-hover:scale-105 transition-transform">
                    <FileCode className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Files Analyzed</span>
                    <span className="text-lg font-extrabold text-rc-foreground mt-0.5 block">{repo.file_count}</span>
                  </div>
                </div>

                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-rc-primary-muted flex items-center justify-center text-rc-primary group-hover:scale-105 transition-transform">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Chunks Indexed</span>
                    <span className="text-lg font-extrabold text-rc-foreground mt-0.5 block">{snapshot.estimatedChunks}</span>
                  </div>
                </div>

                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-rc-accent-muted flex items-center justify-center text-rc-accent group-hover:scale-105 transition-transform">
                    <Code2 className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Main Language</span>
                    <span className="text-lg font-extrabold text-rc-foreground mt-0.5 truncate block">{repo.language || 'Multiple'}</span>
                  </div>
                </div>

                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-pink-500/10 flex items-center justify-center text-pink-500 group-hover:scale-105 transition-transform">
                    <Database className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Codebase Size</span>
                    <span className="text-lg font-extrabold text-rc-foreground mt-0.5 block">{sizeInMB} MB</span>
                  </div>
                </div>

                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-rc-success-muted flex items-center justify-center text-rc-success group-hover:scale-105 transition-transform">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Index Status</span>
                    <span className="text-xs font-bold text-rc-success bg-rc-success-muted border border-rc-success/15 px-1.5 py-0.5 rounded-rc-md truncate block w-fit mt-1.5">
                      {repo.status}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-rc-card border border-rc-border rounded-rc-xl flex flex-col gap-2.5 hover:border-rc-primary/45 hover:scale-[1.02] hover:bg-rc-card-hover hover:shadow-rc-sm transition-all duration-rc-base group">
                  <div className="w-8 h-8 rounded-rc-lg bg-rc-warning-muted flex items-center justify-center text-rc-warning group-hover:scale-105 transition-transform">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Cache Expires</span>
                    <span className="text-xs font-bold text-rc-foreground-secondary truncate block mt-1.5">
                      {new Date(repo.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Suggested Questions */}
          <div className="space-y-4 animate-rc-slide-up duration-rc-slow [animation-delay:200ms]">
            <div>
              <h3 className="rc-text-section-title text-rc-foreground pl-1 font-bold">Suggested Questions</h3>
              <p className="text-xs text-rc-foreground-muted pl-1 mt-1">Select a question to launch the AI Assistant workspace immediately</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggestedQuestions.map((q, idx) => (
                <Link
                  key={idx}
                  href={`/repository/${repo.id}/chat?q=${encodeURIComponent(q)}`}
                  className="group p-5 bg-rc-card border border-rc-border rounded-rc-xl hover:border-rc-primary/65 hover:shadow-rc-md hover:bg-rc-card-hover hover:scale-[1.01] active:scale-[0.99] transition-all duration-rc-base text-left flex items-start justify-between gap-4 focus:outline-none rc-focus-ring"
                  aria-label={`Ask suggested question: ${q}`}
                >
                  <span className="text-sm font-medium text-rc-foreground-secondary group-hover:text-rc-foreground transition-colors leading-relaxed">
                    {q}
                  </span>
                  <ChevronRight className="h-4 w-4 text-rc-primary opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all mt-0.5 shrink-0" />
                </Link>
              ))}
            </div>
          </div>

          {/* 5. Summary Section */}
          <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-sm hover:shadow-rc-md transition-all relative overflow-hidden group animate-rc-slide-up duration-rc-slow [animation-delay:300ms]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />
            
            <div className="flex items-center gap-2.5 mb-5 border-b border-rc-border pb-4">
              <div className="p-2 rounded-rc-lg bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400 border border-cyan-100/30 dark:border-cyan-900/30">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg md:text-xl font-extrabold text-rc-foreground">Codebase Summary</h2>
                <p className="text-xs text-rc-foreground-muted">High-level overview of core purpose and capabilities</p>
              </div>
            </div>

            <div className="prose prose-sm dark:prose-invert max-w-none text-rc-foreground-secondary leading-relaxed">
              <MarkdownViewer text={repo.summary || 'Summary not available.'} />
            </div>
          </div>

          {/* 6. Architecture Section */}
          <div className="bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-sm hover:shadow-rc-md transition-all relative overflow-hidden group animate-rc-slide-up duration-rc-slow [animation-delay:400ms]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-indigo-600" />
            
            <div className="flex items-center gap-2.5 mb-5 border-b border-rc-border pb-4">
              <div className="p-2 rounded-rc-lg bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border border-violet-100/30 dark:border-violet-900/30">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg md:text-xl font-extrabold text-rc-foreground">Architecture Overview</h2>
                <p className="text-xs text-rc-foreground-muted">Detailed layout, component structure, and package flow</p>
              </div>
            </div>

            <div className="prose prose-sm dark:prose-invert max-w-none text-rc-foreground-secondary leading-relaxed">
              <MarkdownViewer text={repo.architecture_overview || 'Architecture overview not available.'} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

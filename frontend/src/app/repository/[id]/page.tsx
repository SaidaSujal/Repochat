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
  FileCode
} from 'lucide-react';

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1 flex flex-col justify-center items-center">
        <div className="flex flex-col items-center gap-4">
          <RotateCw className="h-10 w-10 text-blue-600 animate-spin" />
          <p className="text-gray-500 dark:text-zinc-400 text-sm animate-pulse">Loading repository dashboard...</p>
        </div>
      </div>
    );
  }

  // Handle Expired Cache (410 GONE)
  if (errorStatus === 410) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 flex-1 flex flex-col justify-center text-center">
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-8 rounded-2xl shadow-xl flex flex-col items-center">
          <AlertCircle className="h-16 w-16 text-amber-600 dark:text-amber-500 mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-zinc-100">Repository Cache Expired</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-zinc-400 leading-relaxed">
            Indexed repository caches are automatically purged after 24 hours to preserve vector storage. You must re-index this codebase to query it.
          </p>

          <div className="mt-6 w-full space-y-3">
            {isReingesting ? (
              <div className="flex flex-col items-center gap-3 py-2 bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-250/10">
                <RotateCw className="h-6 w-6 text-blue-600 animate-spin" />
                <span className="text-xs text-gray-500">Re-indexing {reingestUrl || 'codebase'}...</span>
              </div>
            ) : (
              <>
                <button
                  onClick={handleReingest}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-xl transition-all shadow-md"
                >
                  <RotateCw className="h-4 w-4" />
                  <span>Re-index Repository Now</span>
                </button>
                <Link
                  href="/"
                  className="w-full block text-center px-5 py-3 text-sm font-medium text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-xl transition-all"
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
      <div className="max-w-xl mx-auto px-4 py-20 flex-1 flex flex-col justify-center text-center">
        <div className="bg-red-50 dark:bg-red-950/10 border border-red-200 dark:border-red-900/40 p-8 rounded-2xl shadow-xl flex flex-col items-center">
          <AlertCircle className="h-16 w-16 text-red-600 dark:text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-zinc-100">Repository Not Found</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-zinc-400">
            {errorMessage || 'The requested repository could not be located in cache. It may have expired or was never indexed.'}
          </p>
          <Link
            href="/"
            className="mt-6 flex items-center gap-2 px-5 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-md"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Go to homepage</span>
          </Link>
        </div>
      </div>
    );
  }

  // Format repository total size to readable MB
  const sizeInMB = (repo.total_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col gap-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-200 dark:border-zinc-850 pb-6">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 mb-2 font-medium">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to ingestion
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-zinc-50 break-all">
              {repo.owner}/{repo.name}
            </h1>
            <a 
              href={repo.github_url} 
              target="_blank" 
              rel="noreferrer" 
              className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 transition-colors"
              title="Open GitHub repository"
            >
              <ExternalLink className="h-5 w-5" />
            </a>
          </div>
          {repo.status === 'COMPLETED' && (
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Cache expires at: {new Date(repo.expires_at).toLocaleString()}
            </p>
          )}
        </div>

        {repo.status === 'COMPLETED' ? (
          <Link
            href={`/repository/${repo.id}/chat`}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-md hover:scale-[1.02] active:scale-95 shrink-0"
          >
            <MessageSquare className="h-5 w-5" />
            <span>Open Chat Assistant</span>
          </Link>
        ) : (
          <button
            disabled
            className="flex items-center gap-2 px-6 py-3 bg-gray-200 dark:bg-zinc-800 text-gray-500 dark:text-zinc-500 font-bold rounded-xl transition-all cursor-not-allowed shrink-0"
          >
            <MessageSquare className="h-5 w-5 animate-pulse" />
            <span>Chat Disabled ({repo.status})</span>
          </button>
        )}
      </div>

      {repo.status === 'PENDING' || repo.status === 'PROCESSING' ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-12 shadow-sm flex-1 flex flex-col justify-center items-center text-center max-w-xl mx-auto w-full my-8">
          <RotateCw className="h-12 w-12 text-blue-600 animate-spin mb-4" />
          <h3 className="text-lg font-bold text-gray-800 dark:text-zinc-200">
            {repo.status === 'PENDING' ? 'Ingestion Queued' : 'Ingestion Processing'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-2 leading-relaxed">
            {repo.status === 'PENDING' 
              ? 'Repository ingestion task is queued in our memory buffer and waiting to be processed by our background worker.' 
              : 'Our background worker is currently cloning, parsing, embedding, and indexing your repository code chunks.'}
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs font-semibold bg-blue-50 dark:bg-blue-950/15 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-lg border border-blue-100/40 dark:border-blue-950/40 animate-pulse">
            <span>Status: {repo.status} (polling for updates...)</span>
          </div>
        </div>
      ) : repo.status === 'FAILED' ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm flex-1 flex flex-col justify-center items-center text-center max-w-xl mx-auto w-full my-8">
          <AlertCircle className="h-16 w-16 text-red-600 dark:text-red-500 mb-4 animate-bounce" />
          <h3 className="text-lg font-bold text-gray-850 dark:text-zinc-150">Ingestion Pipeline Failed</h3>
          <p className="text-sm text-gray-600 dark:text-zinc-400 mt-2 leading-relaxed">
            {getFriendlyIngestionErrorMessage(repo.error_message)}
          </p>
          <div className="w-full mt-4 text-left">
            <details className="group bg-red-50/50 dark:bg-red-950/10 border border-red-200/50 dark:border-red-900/20 rounded-xl overflow-hidden">
              <summary className="flex items-center justify-between p-3 text-xs font-semibold text-red-800 dark:text-red-400 cursor-pointer hover:bg-red-100/30 dark:hover:bg-red-950/20 select-none">
                <span>View technical details for developers</span>
                <span className="transition-transform group-open:rotate-180">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <div className="p-4 border-t border-red-200/40 dark:border-red-900/10 bg-white/50 dark:bg-zinc-950/20 font-mono text-xs text-gray-600 dark:text-zinc-400 max-h-48 overflow-y-auto break-all whitespace-pre-wrap">
                {repo.error_message || 'No raw traceback logs available.'}
              </div>
            </details>
          </div>
          <div className="mt-6 w-full space-y-3">
            {isReingesting ? (
              <div className="flex flex-col items-center gap-3 py-2 bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-250/10">
                <RotateCw className="h-6 w-6 text-blue-600 animate-spin" />
                <span className="text-xs text-gray-500">Restarting ingestion pipeline...</span>
              </div>
            ) : (
              <button
                onClick={handleReingest}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-xl transition-all shadow-md active:scale-95"
              >
                <RotateCw className="h-4 w-4" />
                <span>Retry Ingestion Workflow</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Stats Cards Section */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">Language</span>
              <div className="flex items-center gap-1.5 mt-1">
                <Code2 className="h-4 w-4 text-blue-500" />
                <span className="text-base font-bold text-gray-800 dark:text-zinc-200 truncate">{repo.language || 'Multiple'}</span>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">GitHub Stars</span>
              <div className="flex items-center gap-1.5 mt-1">
                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                <span className="text-base font-bold text-gray-800 dark:text-zinc-200">{repo.star_count}</span>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">GitHub Forks</span>
              <div className="flex items-center gap-1.5 mt-1">
                <GitFork className="h-4 w-4 text-indigo-500" />
                <span className="text-base font-bold text-gray-800 dark:text-zinc-200">{repo.fork_count}</span>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">Indexable Files</span>
              <div className="flex items-center gap-1.5 mt-1">
                <FileCode className="h-4 w-4 text-green-500" />
                <span className="text-base font-bold text-gray-800 dark:text-zinc-200">{repo.file_count}</span>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm col-span-2 md:col-span-1">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">Total Size</span>
              <div className="flex items-center gap-1.5 mt-1">
                <Database className="h-4 w-4 text-teal-500" />
                <span className="text-base font-bold text-gray-800 dark:text-zinc-200">{sizeInMB} MB</span>
              </div>
            </div>
          </div>

          {/* Main summary / architecture presentation */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex-1 flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-800 mb-6">
              <button
                onClick={() => setActiveTab('summary')}
                className={`pb-3 text-sm font-semibold border-b-2 px-4 transition-all -mb-px flex items-center gap-2 ${
                  activeTab === 'summary'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500'
                    : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
                }`}
              >
                <FileText className="h-4 w-4" />
                <span>Codebase Summary</span>
              </button>
              <button
                onClick={() => setActiveTab('architecture')}
                className={`pb-3 text-sm font-semibold border-b-2 px-4 transition-all -mb-px flex items-center gap-2 ${
                  activeTab === 'architecture'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500'
                    : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
                }`}
              >
                <Layers className="h-4 w-4" />
                <span>Architecture Overview</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'summary' ? (
                <div className="prose dark:prose-invert max-w-none">
                  <MarkdownViewer text={repo.summary || 'Summary not available.'} />
                </div>
              ) : (
                <div className="prose dark:prose-invert max-w-none">
                  <MarkdownViewer text={repo.architecture_overview || 'Architecture overview not available.'} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

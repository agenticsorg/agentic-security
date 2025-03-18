
import { useState, useEffect } from 'react';
import { ScanResult, ScanRequest } from '@/types/scanner';
import { generateMockScanResult, generateMockHistory } from '@/utils/mockData';
import { toast } from 'sonner';

const STORAGE_KEY = 'security-scanner-history';
const EDGE_FUNCTION_BASE_URL = 'https://eojucgnpskovtadfwfir.supabase.co/functions/v1/security-scanner';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvanVjZ25wc2tvdnRhZGZ3ZmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2NDA3OTgsImV4cCI6MjA1MDIxNjc5OH0.n354_1M5MfeLPtiafQ4nN4QiYStK8N8cCpNw7eLW93Y';

interface ScanStore {
  history: ScanResult[];
  loading: boolean;
  currentScan: ScanResult | null;
  runScan: (request: ScanRequest) => Promise<ScanResult>;
  clearHistory: () => void;
  deleteResult: (id: string) => void;
}

export const useScanStore = (): ScanStore => {
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentScan, setCurrentScan] = useState<ScanResult | null>(null);

  // Load history from local storage on initial mount only
  useEffect(() => {
    console.log('Loading scan history from localStorage');
    try {
      const storedHistory = localStorage.getItem(STORAGE_KEY);
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory);
        console.log('Found stored history:', parsedHistory.length, 'items');
        setHistory(parsedHistory);
      } else {
        console.log('No stored history found, initializing with mock data');
        // For demo purposes, initialize with mock data
        const mockHistory = generateMockHistory(3);
        setHistory(mockHistory);
        saveHistoryToStorage(mockHistory);
      }
    } catch (error) {
      console.error('Failed to load scan history:', error);
      toast.error('Failed to load scan history');
    }
  }, []);

  // Helper function to save history to localStorage
  const saveHistoryToStorage = (historyData: ScanResult[]) => {
    try {
      console.log('Saving history to localStorage:', historyData.length, 'items');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(historyData));
    } catch (error) {
      console.error('Failed to save scan history to localStorage:', error);
    }
  };

  const runScan = async (request: ScanRequest): Promise<ScanResult> => {
    setLoading(true);
    console.log('Scan started, loading state:', true);
    console.log('Scan request params:', request);
    
    try {
      // Prepare request payload with advanced options
      const payload = {
        repo: request.repository,
        branch: request.branch || 'main',
        // Include advanced options if provided
        ...(request.useWebSearch !== undefined && { useWebSearch: request.useWebSearch }),
        ...(request.sendReport && request.recipient && { 
          sendReport: true,
          recipient: request.recipient
        }),
        ...(request.createIssues !== undefined && { createIssues: request.createIssues }),
        ...(request.includeRecommendations !== undefined && { 
          includeRecommendations: request.includeRecommendations 
        }),
        ...(request.scanDepth && { scanDepth: request.scanDepth }),
        ...(request.fileTypes && { fileTypes: request.fileTypes }),
        ...(request.scanHistory && { scanHistory: request.scanHistory })
      };
      
      // Use the correct endpoint URL with the scan-repo route
      const endpoint = `${EDGE_FUNCTION_BASE_URL}/scan-repo`;
      console.log('Calling security scanner API:', endpoint);
      
      // Make an actual API call to the deployed edge function
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('API response received:', data);
      
      // Fallback to mock data if the API response doesn't match expected format
      let result: ScanResult;
      
      try {
        // Map the API response to our ScanResult type
        result = {
          id: data.scanId || `scan_${Date.now()}`,
          repository: request.repository,
          branch: request.branch || 'main',
          timestamp: data.timestamp || new Date().toISOString(),
          findings: data.findings || [],
          summary: data.summary || {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          },
          status: data.status || 'completed',
        };
        
        // Validate or populate summary counts if they don't exist
        if (!data.summary) {
          const summary = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          };
          
          // Calculate summary counts from findings
          if (Array.isArray(result.findings)) {
            result.findings.forEach(finding => {
              if (finding.severity && summary[finding.severity] !== undefined) {
                summary[finding.severity]++;
              }
            });
          }
          
          result.summary = summary;
        }
      } catch (error) {
        console.error('Error parsing API response:', error);
        console.log('Falling back to mock data');
        // Fall back to mock data if there's an issue
        result = generateMockScanResult(request.repository, request.branch);
      }
      
      // Special handling for email reports
      if (request.sendReport && request.recipient && data.reportSent) {
        toast.success(`Security report sent to ${request.recipient}`);
      }
      
      // Special handling for GitHub issues
      if (request.createIssues && data.issuesCreated) {
        toast.success(`Created ${data.issuesCreated} GitHub issues for critical findings`);
      }
      
      // Update state and store in localStorage
      setCurrentScan(result);
      
      // Update history with the new scan at the beginning
      const updatedHistory = [result, ...history];
      setHistory(updatedHistory);
      
      // Save to localStorage immediately after updating state
      saveHistoryToStorage(updatedHistory);
      
      console.log('Scan completed successfully, history updated:', updatedHistory.length, 'items');
      toast.success('Security scan completed');
      
      return result;
    } catch (error) {
      console.error('Scan failed:', error);
      toast.error(`Security scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Fall back to mock data in case of error
      const mockResult = generateMockScanResult(request.repository, request.branch);
      return mockResult;
    } finally {
      console.log('Scan completed, setting loading state to false');
      setLoading(false);
    }
  };

  const clearHistory = () => {
    console.log('Clearing scan history');
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    toast.success('Scan history cleared');
  };

  const deleteResult = (id: string) => {
    console.log('Deleting scan result with ID:', id);
    const updatedHistory = history.filter(result => result.id !== id);
    setHistory(updatedHistory);
    
    // Save the updated history to localStorage
    saveHistoryToStorage(updatedHistory);
    
    if (currentScan?.id === id) {
      setCurrentScan(null);
    }
    toast.success('Scan result deleted');
  };

  return {
    history,
    loading,
    currentScan,
    runScan,
    clearHistory,
    deleteResult,
  };
};

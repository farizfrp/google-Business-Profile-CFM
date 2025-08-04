import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [reviews, setReviews] = useState([]);
  const [replyText, setReplyText] = useState({});
  const [outletCodes, setOutletCodes] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoFetched, setAutoFetched] = useState(false);
  
  // Report page state
  const [showReports, setShowReports] = useState(false);
  const [reportPassword, setReportPassword] = useState('');
  const [reportAuthenticated, setReportAuthenticated] = useState(false);
  const [reportData, setReportData] = useState({ locations: [], statistics: {} });
  const [reportLoading, setReportLoading] = useState(false);

  // OAuth 2.0 Functions
  useEffect(() => {
    // Check for OAuth callback parameters
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access_token');
    const refreshTokenParam = urlParams.get('refresh_token');
    const expiresIn = urlParams.get('expires_in');
    const userIdParam = urlParams.get('user_id');
    const userEmailParam = urlParams.get('user_email');
    const userNameParam = urlParams.get('user_name');
    const autoFetchSuccess = urlParams.get('auto_fetch_success');
    const errorParam = urlParams.get('error');

    if (errorParam) {
      setError('OAuth authentication failed: ' + errorParam);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (accessToken) {
      setToken(accessToken);
      if (refreshTokenParam) {
        setRefreshToken(refreshTokenParam);
      }
      if (expiresIn) {
        const expiry = new Date(Date.now() + parseInt(expiresIn) * 1000);
        setTokenExpiry(expiry);
      }
      if (userIdParam) {
        setUserId(userIdParam);
        setSelectedUserId(userIdParam); // Also set as selected user
      }
      if (userEmailParam) {
        setUserEmail(decodeURIComponent(userEmailParam));
      }
      if (userNameParam) {
        setUserName(decodeURIComponent(userNameParam));
      }
      
      if (autoFetchSuccess === 'true') {
        setError('Successfully authenticated! Your accounts and locations have been loaded automatically.');
        setAutoFetched(true);
        // Auto-load stored accounts and locations
        setTimeout(() => {
          loadStoredAccountsAndLocations(userIdParam);
        }, 500);
      } else {
        setError('Successfully authenticated! Loading your accounts...');
        // Auto-load accounts even if auto-fetch partially failed
        setTimeout(() => {
          loadStoredAccountsAndLocations(userIdParam);
        }, 500);
      }
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Load all users for selection
    loadAllUsers();

    // Load saved tokens and user info from localStorage
    const savedToken = localStorage.getItem('google_access_token');
    const savedRefreshToken = localStorage.getItem('google_refresh_token');
    const savedExpiry = localStorage.getItem('google_token_expiry');
    const savedUserId = localStorage.getItem('user_id');
    const savedUserEmail = localStorage.getItem('user_email');
    const savedUserName = localStorage.getItem('user_name');

    if (savedToken && savedExpiry) {
      const expiry = new Date(savedExpiry);
      if (expiry > new Date()) {
        setToken(savedToken);
        setRefreshToken(savedRefreshToken);
        setTokenExpiry(expiry);
        if (savedUserId) {
          setUserId(savedUserId);
          setSelectedUserId(savedUserId);
          setUserEmail(savedUserEmail || '');
          setUserName(savedUserName || '');
          // Auto-load stored accounts and locations
          setTimeout(() => {
            loadStoredAccountsAndLocations(savedUserId);
          }, 500);
        }
      } else if (savedRefreshToken) {
        // Token expired, try to refresh
        refreshAccessToken(savedRefreshToken);
      }
    }
  }, []);

  // Save tokens and user info to localStorage
  useEffect(() => {
    if (token) {
      localStorage.setItem('google_access_token', token);
    }
    if (refreshToken) {
      localStorage.setItem('google_refresh_token', refreshToken);
    }
    if (tokenExpiry) {
      localStorage.setItem('google_token_expiry', tokenExpiry.toISOString());
    }
    if (userId) {
      localStorage.setItem('user_id', userId);
    }
    if (userEmail) {
      localStorage.setItem('user_email', userEmail);
    }
    if (userName) {
      localStorage.setItem('user_name', userName);
    }
  }, [token, refreshToken, tokenExpiry, userId, userEmail, userName]);

  // Periodic token check and auto-refresh
  useEffect(() => {
    if (!token) return;

    const checkTokenExpiry = () => {
      const status = getTokenStatus();
      if (status === 'expired' && refreshToken) {
        setError('Token expired, auto-refreshing...');
        refreshAccessToken();
      } else if (status === 'expiring_soon' && refreshToken) {
        // Proactively refresh tokens that expire in less than 5 minutes
        setError('Token expiring soon, refreshing automatically...');
        refreshAccessToken();
      }
    };

    // Check immediately
    checkTokenExpiry();

    // Check every minute
    const interval = setInterval(checkTokenExpiry, 60000);
    
    return () => clearInterval(interval);
  }, [token, tokenExpiry, refreshToken]);

  // Enhanced token refresh with better error handling
  const handleTokenRefresh = async () => {
    if (!refreshToken) {
      setError('No refresh token available. Please login again.');
      return false;
    }

    try {
      setLoading(true);
      setError('Refreshing access token...');
      
      const success = await refreshAccessToken();
      
      if (success) {
        setError('✅ Token refreshed successfully! You can now access your accounts.');
        // Reload data after successful refresh
        if (userId) {
          setTimeout(() => {
            loadStoredAccountsAndLocations(userId);
          }, 500);
        }
        return true;
      } else {
        setError('❌ Failed to refresh token. Please login again.');
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      setError('❌ Error refreshing token: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const response = await fetch('/auth/google/url');
      const data = await response.json();
      
      if (data.authUrl) {
        // Redirect to Google OAuth
        window.location.href = data.authUrl;
      } else {
        setError('Failed to get OAuth URL');
      }
    } catch (error) {
      console.error('Error getting OAuth URL:', error);
      setError('Failed to initiate OAuth: ' + error.message);
    }
  };

  const refreshAccessToken = async (refreshTokenToUse = refreshToken) => {
    if (!refreshTokenToUse) {
      setError('No refresh token available. Please login again.');
      handleLogout();
      return false;
    }

    try {
      setLoading(true);
      
      const response = await fetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          refresh_token: refreshTokenToUse,
          user_id: userId 
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('Token refresh failed:', responseData);
        
        if (responseData.code === 'INVALID_REFRESH_TOKEN') {
          setError('🔒 Session expired. Please login again.');
          handleLogout();
          return false;
        }
        
        throw new Error(responseData.error || 'Failed to refresh token');
      }

      console.log('Token refreshed successfully:', responseData.refreshed_at);
      
      setToken(responseData.access_token);
      
      if (responseData.expires_in) {
        const expiry = new Date(Date.now() + parseInt(responseData.expires_in) * 1000);
        setTokenExpiry(expiry);
      }

      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      setError(`🔄 Failed to refresh token: ${error.message}`);
      
      // Don't logout immediately for network errors, give user a chance to retry
      if (!error.message.includes('Session expired')) {
        setTimeout(() => {
          if (getTokenStatus() === 'expired') {
            setError('🔒 Unable to refresh token. Please login again.');
            handleLogout();
          }
        }, 10000); // Wait 10 seconds before forcing logout
      }
      
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setRefreshToken('');
    setTokenExpiry(null);
    setUserId('');
    setSelectedUserId('');
    setUserEmail('');
    setUserName('');
    setAccounts([]);
    setAllLocations([]);
    setSelectedLocation('');
    setReviews([]);
    setOutletCodes({});
    setAutoFetched(false);
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_refresh_token');
    localStorage.removeItem('google_token_expiry');
    localStorage.removeItem('user_id');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_name');
    setError('');
  };

  const isTokenExpired = () => {
    if (!tokenExpiry) return false;
    return new Date() >= tokenExpiry;
  };

  const isTokenExpiringSoon = () => {
    if (!tokenExpiry) return false;
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return tokenExpiry <= fiveMinutesFromNow;
  };

  const getTokenStatus = () => {
    if (!token) return 'no_token';
    if (isTokenExpired()) return 'expired';
    if (isTokenExpiringSoon()) return 'expiring_soon';
    return 'valid';
  };

  // Simulate token expiration for testing
  const simulateTokenExpiration = () => {
    if (token) {
      const expiredTime = new Date(Date.now() - 1000); // 1 second ago
      setTokenExpiry(expiredTime);
      setError('🧪 Token expiration simulated! Next API call will trigger refresh.');
    }
  };

  // Check token before API calls
  const ensureValidToken = async () => {
    if (!token) {
      setError('Please login with Google first');
      return false;
    }

    const status = getTokenStatus();
    
    if (status === 'expired') {
      setError('Token expired, refreshing...');
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        return false;
      }
      setError('✅ Token refreshed successfully!');
      return true;
    }
    
    if (status === 'expiring_soon') {
      setError('Token expiring soon, refreshing proactively...');
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        setError('⚠️ Failed to refresh token proactively, but current token is still valid');
        return true; // Continue with current token
      }
      setError('✅ Token refreshed proactively!');
      return true;
    }

    return true;
  };

  // Load stored accounts and all locations from database
  const loadStoredAccountsAndLocations = async (userIdToUse = userId) => {
    if (!userIdToUse) {
      console.log('No user ID available for loading stored data');
      return;
    }

    try {
      setLoading(true);
      
      // Load stored accounts
      const accountsResponse = await fetch(`/api/accounts/stored/${userIdToUse}`);
      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json();
        setAccounts(accountsData.accounts || []);
      }
      
      // Load all locations across all accounts
      const allLocationsResponse = await fetch(`/api/locations/all/${userIdToUse}`);
      if (allLocationsResponse.ok) {
        const locationsData = await allLocationsResponse.json();
        if (locationsData.locations && locationsData.locations.length > 0) {
          setAllLocations(locationsData.locations);
          
          // Initialize outlet codes state
          const initialOutletCodes = {};
          locationsData.locations.forEach(location => {
            const key = `${location.account_id}_${location.location_id}`;
            initialOutletCodes[key] = location.outlet_code || '';
          });
          setOutletCodes(initialOutletCodes);
        } else {
          // No stored locations, try to fetch fresh ones if we have a token
          if (token) {
            handleGetAccounts();
          }
        }
      }
    } catch (error) {
      console.error('Error loading stored data:', error);
      // Fallback to fetching fresh data if available
      if (token) {
        handleGetAccounts();
      }
    } finally {
      setLoading(false);
    }
  };

  // Load all authenticated users
  const loadAllUsers = async () => {
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  // Switch to a different user
  const switchToUser = async (newUserId) => {
    if (newUserId === selectedUserId) return; // Already selected
    
    try {
      setLoading(true);
      setError('Switching user...');
      
      // Find the selected user
      const selectedUser = allUsers.find(user => user.user_id === newUserId);
      if (!selectedUser) {
        setError('User not found');
        return;
      }
      
      // Update current user info
      setSelectedUserId(newUserId);
      setUserId(newUserId);
      setUserEmail(selectedUser.email);
      setUserName(selectedUser.name);
      
      // Get user's tokens
      const tokensResponse = await fetch(`/api/user/${newUserId}/tokens`);
      if (tokensResponse.ok) {
        const tokensData = await tokensResponse.json();
        const tokens = tokensData.tokens;
        
        setToken(tokens.access_token || '');
        setRefreshToken(tokens.refresh_token || '');
        if (tokens.expires_at) {
          setTokenExpiry(new Date(tokens.expires_at));
        }
        
        // Update localStorage
        if (tokens.access_token) localStorage.setItem('google_access_token', tokens.access_token);
        if (tokens.refresh_token) localStorage.setItem('google_refresh_token', tokens.refresh_token);
        if (tokens.expires_at) localStorage.setItem('google_token_expiry', tokens.expires_at);
        localStorage.setItem('user_id', newUserId);
        localStorage.setItem('user_email', selectedUser.email);
        localStorage.setItem('user_name', selectedUser.name);
        
        // Load user's accounts and locations
        await loadStoredAccountsAndLocations(newUserId);
        
        setError(`✅ Switched to ${selectedUser.name} (${selectedUser.email})`);
      } else {
        setError('No tokens found for this user. They may need to re-authenticate.');
        // Clear current tokens
        setToken('');
        setRefreshToken('');
        setTokenExpiry(null);
        setAccounts([]);
        setAllLocations([]);
      }
      
    } catch (error) {
      console.error('Error switching user:', error);
      setError('Error switching user: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Get Accounts
  const handleGetAccounts = async () => {
    const isValid = await ensureValidToken();
    if (!isValid) return;

    setLoading(true);
    setError('');
    
    try {
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      };
      
      // Include user ID if available for database storage
      if (userId) {
        headers['x-user-id'] = userId;
      }
      
      const response = await fetch('/api/accounts', {
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const fetchedAccounts = data.accounts || [];
      setAccounts(fetchedAccounts);
      setSelectedLocation('');
      setReviews([]);
      
      // Auto-load all locations after getting accounts
      if (userId) {
        setTimeout(() => {
          loadStoredAccountsAndLocations(userId);
        }, 100);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
      setError('Error fetching accounts: ' + error.message);
    } finally {
      setLoading(false);
    }
  };





  // Reply to Review
  const handleReplyToReview = async (reviewName) => {
    const reply = replyText[reviewName];
    if (!reply) {
      setError('Please enter a reply message');
      return;
    }

    const isValid = await ensureValidToken();
    if (!isValid) return;

    setLoading(true);
    setError('');

    try {
      // Extract account ID, location ID, and review ID from review name
      // reviewName format: "accounts/123/locations/456/reviews/789"
      const pathParts = reviewName.split('/');
      const accountId = pathParts[1]; // Extract "123" from "accounts/123"
      const locationId = pathParts[3]; // Extract "456" from "locations/456"  
      const reviewId = pathParts[5]; // Extract "789" from "reviews/789"
      
      if (!accountId || !locationId || !reviewId) {
        throw new Error('Invalid review name format');
      }
      
      const response = await fetch(`/api/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: reply }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Refresh reviews after replying by calling handleGetReviews with the account and location
      await handleGetReviews(`accounts/${accountId}`, `accounts/${accountId}/locations/${locationId}`);
      // Clear the reply text for that review
      setReplyText(prev => ({...prev, [reviewName]: ''}));
      setError('Reply sent successfully!');
    } catch (error) {
      console.error('Error replying to review:', error);
      setError('Error replying to review: ' + error.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleReplyTextChange = (reviewName, text) => {
    setReplyText(prev => ({...prev, [reviewName]: text}));
  };

  // Handle outlet code change
  const handleOutletCodeChange = (accountId, locationId, value) => {
    const key = `${accountId}_${locationId}`;
    setOutletCodes(prev => ({...prev, [key]: value}));
  };

  // Save outlet code to database
  const saveOutletCode = async (accountId, locationId) => {
    if (!userId) {
      setError('User ID not available');
      return;
    }

    const key = `${accountId}_${locationId}`;
    const outletCode = outletCodes[key];

    try {
      const response = await fetch('/api/locations/outlet-code', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          accountId,
          locationId,
          outletCode
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      setError('✅ Outlet code saved successfully!');
      setTimeout(() => setError(''), 3000);
    } catch (error) {
      console.error('Error saving outlet code:', error);
      setError('Error saving outlet code: ' + error.message);
    }
  };

  const handleGetReviews = async (accountId, locationId) => {
    if (!accountId || !locationId) {
      setError('Please provide account and location information');
      return;
    }

    const isValid = await ensureValidToken();
    if (!isValid) return;

    setLoading(true);
    setError('');
    
    try {
      // Extract IDs from the full names if needed
      const cleanAccountId = accountId.replace('accounts/', '');
      const cleanLocationId = locationId.replace('locations/', '');
      
      const response = await fetch(`/api/accounts/${cleanAccountId}/locations/${cleanLocationId}/reviews`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setReviews(data.reviews || []);
      setSelectedLocation(`${accountId}/locations/${cleanLocationId}`);
    } catch (error) {
      console.error('Error fetching reviews:', error);
      setError('Error fetching reviews: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Report Functions
  const handleReportPasswordSubmit = async () => {
    if (!reportPassword) {
      setError('Please enter the report password');
      return;
    }

    setReportLoading(true);
    setError('');

    try {
      const response = await fetch('/api/reports/authenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: reportPassword }),
      });

      const data = await response.json();

      if (data.success) {
        setReportAuthenticated(true);
        setReportPassword('');
        await loadReportData();
      } else {
        setError('Invalid password');
        setReportPassword('');
      }
    } catch (error) {
      console.error('Error authenticating report access:', error);
      setError('Error authenticating: ' + error.message);
    } finally {
      setReportLoading(false);
    }
  };

  const loadReportData = async () => {
    if (!reportAuthenticated) return;

    setReportLoading(true);
    
    try {
      // Fetch locations and statistics in parallel
      const [locationsResponse, statisticsResponse] = await Promise.all([
        fetch('/api/reports/locations', {
          headers: { password: 'Jakarta2025' }
        }),
        fetch('/api/reports/statistics', {
          headers: { password: 'Jakarta2025' }
        })
      ]);

      const locationsData = await locationsResponse.json();
      const statisticsData = await statisticsResponse.json();

      setReportData({
        locations: locationsData.locations || [],
        statistics: statisticsData
      });
    } catch (error) {
      console.error('Error loading report data:', error);
      setError('Error loading report data: ' + error.message);
    } finally {
      setReportLoading(false);
    }
  };

  const handleExportCSV = async () => {
    if (!reportAuthenticated) return;

    try {
      const response = await fetch('/api/reports/export/csv', {
        headers: { password: 'Jakarta2025' }
      });

      if (!response.ok) {
        throw new Error('Failed to export CSV');
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `all_locations_report_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      setError('Error exporting CSV: ' + error.message);
    }
  };

  const toggleReportsView = () => {
    setShowReports(!showReports);
    if (!showReports && reportAuthenticated) {
      loadReportData();
    }
  };

  return (
    <div className="App">
      <div className="container">
        <div className="header-section">
          <h1>Google Business Profile Review Manager</h1>
          <div className="navigation">
            <button 
              onClick={toggleReportsView} 
              className={`nav-button ${showReports ? 'active' : ''}`}
            >
              📊 {showReports ? 'Back to Main' : 'Reports'}
            </button>
          </div>
        </div>
        
        {error && (
          <div className={`message ${error.includes('successfully') || error.includes('✅') ? 'success' : 'error'}`}>
            {error}
          </div>
        )}
        
        {loading && <div className="loading">Loading...</div>}
        {reportLoading && <div className="loading">Loading report data...</div>}

        {/* Reports Section */}
        {showReports ? (
          <div className="reports-container">
            {!reportAuthenticated ? (
              <div className="section">
                <h2>🔐 Report Access</h2>
                <p>Enter the password to access comprehensive reports and statistics.</p>
                <div className="input-group">
                  <input
                    type="password"
                    value={reportPassword}
                    onChange={(e) => setReportPassword(e.target.value)}
                    placeholder="Enter report password"
                    className="password-input"
                    onKeyPress={(e) => e.key === 'Enter' && handleReportPasswordSubmit()}
                  />
                  <button 
                    onClick={handleReportPasswordSubmit}
                    disabled={reportLoading || !reportPassword}
                    className="password-submit-button"
                  >
                    {reportLoading ? 'Authenticating...' : 'Access Reports'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="reports-content">
                <div className="section">
                  <div className="reports-header">
                    <h2>📊 System Reports & Statistics</h2>
                    <button 
                      onClick={handleExportCSV}
                      className="export-button"
                      disabled={reportLoading}
                    >
                      📄 Export All Data to CSV
                    </button>
                  </div>
                  
                  {/* Statistics Cards */}
                  <div className="stats-grid">
                    <div className="stat-card">
                      <h3>👥 Total Users</h3>
                      <div className="stat-number">{reportData.statistics.totalUsers || 0}</div>
                    </div>
                    <div className="stat-card">
                      <h3>🏢 Total Accounts</h3>
                      <div className="stat-number">{reportData.statistics.totalAccounts || 0}</div>
                    </div>
                    <div className="stat-card">
                      <h3>📍 Total Locations</h3>
                      <div className="stat-number">{reportData.statistics.totalLocations || 0}</div>
                    </div>
                    <div className="stat-card">
                      <h3>🏷️ With Outlet Codes</h3>
                      <div className="stat-number">{reportData.statistics.locationsWithOutletCodes || 0}</div>
                    </div>
                    <div className="stat-card">
                      <h3>🆕 New Users (30 days)</h3>
                      <div className="stat-number">{reportData.statistics.recentNewUsers || 0}</div>
                    </div>
                  </div>

                  {/* Locations by User */}
                  {reportData.statistics.locationsByUser && reportData.statistics.locationsByUser.length > 0 && (
                    <div className="user-stats-section">
                      <h3>📊 Locations by User</h3>
                      <div className="user-stats-table">
                        <table className="stats-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Email</th>
                              <th>Location Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.statistics.locationsByUser.map((user, index) => (
                              <tr key={index}>
                                <td>{user.name || 'N/A'}</td>
                                <td>{user.email}</td>
                                <td className="stat-number">{user.location_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* All Locations Table */}
                  <div className="all-locations-section">
                    <h3>🗺️ All Locations ({reportData.locations.length})</h3>
                    <div className="locations-table-container">
                      <table className="locations-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Account</th>
                            <th>Location Name</th>
                            <th>Address</th>
                            <th>Outlet Code</th>
                            <th>Maps</th>
                            <th>Reviews</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.locations.map((location, index) => (
                            <tr key={index}>
                              <td className="user-info">
                                <div>{location.user_name || 'N/A'}</div>
                                <div className="user-email">{location.user_email}</div>
                              </td>
                              <td>{location.account_name || 'N/A'}</td>
                              <td>{location.title || 'N/A'}</td>
                              <td>{location.address || 'N/A'}</td>
                              <td>{location.outlet_code || 'N/A'}</td>
                              <td>
                                {location.maps_uri ? (
                                  <a 
                                    href={location.maps_uri} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="uri-link small"
                                  >
                                    📍
                                  </a>
                                ) : 'N/A'}
                              </td>
                              <td>
                                {location.new_review_uri ? (
                                  <a 
                                    href={location.new_review_uri} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="uri-link small"
                                  >
                                    ⭐
                                  </a>
                                ) : 'N/A'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* User Selection Section */}
            {allUsers.length > 1 && (
          <div className="section">
            <h2>Select User Account</h2>
            <div className="user-selection">
              <div className="user-dropdown-container">
                <select 
                  value={selectedUserId} 
                  onChange={(e) => switchToUser(e.target.value)}
                  className="user-select"
                  disabled={loading}
                >
                  <option value="">Select a user account...</option>
                  {allUsers.map(user => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
                <div className="user-count">
                  {allUsers.length} authenticated account{allUsers.length !== 1 ? 's' : ''} available
                </div>
              </div>
              <div className="add-account-section">
                <p>Want to add another Google account?</p>
                <button onClick={handleGoogleLogin} disabled={loading} className="oauth-button">
                  🔐 Add Another Account
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Authentication Section */}
        <div className="section">
          <h2>Authentication</h2>
          {!token ? (
            <div className="input-group">
              <p>Please sign in with your Google account to manage your business profile and reviews.</p>
              <button onClick={handleGoogleLogin} disabled={loading} className="oauth-button">
                🔐 Sign in with Google
              </button>
            </div>
          ) : (
            <div className="input-group">
              <div className="auth-status">
                <div className="user-info">
                  {userName && <p><strong>👤 {userName}</strong></p>}
                  {userEmail && <p>📧 {userEmail}</p>}
                </div>
                <div className="token-status">
                  {getTokenStatus() === 'valid' && <p>✅ Authenticated with Google</p>}
                  {getTokenStatus() === 'expiring_soon' && <p>⚠️ Token expiring soon</p>}
                  {getTokenStatus() === 'expired' && <p>❌ Token expired</p>}
                </div>
                {tokenExpiry && (
                  <div className="token-details">
                    <p className="token-expiry">
                      Expires: {tokenExpiry.toLocaleString()}
                    </p>
                    <p className="token-time-left">
                      {getTokenStatus() === 'expired' ? 
                        'Expired' : 
                        `${Math.max(0, Math.floor((tokenExpiry - new Date()) / 1000 / 60))} minutes left`
                      }
                    </p>
                  </div>
                )}
                {refreshToken && (
                  <p className="refresh-available">🔄 Auto-refresh available</p>
                )}
              </div>
              <div className="auth-actions">
                <button onClick={handleGetAccounts} disabled={loading}>
                  {accounts.length > 0 ? 'Refresh Accounts' : 'Get Accounts'}
                </button>
                <button 
                  onClick={handleTokenRefresh} 
                  disabled={loading || !refreshToken}
                  className="refresh-button"
                >
                  🔄 Refresh Token
                </button>
                <button 
                  onClick={simulateTokenExpiration} 
                  disabled={loading}
                  className="simulate-button"
                >
                  🧪 Simulate Expiry
                </button>
                <button onClick={handleLogout} className="logout-button">
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Authorized Accounts Section */}
        {accounts.length > 0 && (
          <div className="section">
            <h2>Authorized Google Business Accounts ({accounts.length})</h2>
            <div className="accounts-grid">
              {accounts.map((account, index) => (
                <div key={account.name || index} className="account-card">
                  <div className="account-header">
                    <h3>{account.accountName || 'Unnamed Account'}</h3>
                    <span className="account-type">{account.type || 'Business'}</span>
                  </div>
                  <div className="account-id">
                    <span>ID: {account.name ? account.name.replace('accounts/', '') : 'N/A'}</span>
                  </div>
                  <div className="account-actions">
                    {getTokenStatus() === 'expired' ? (
                      <button 
                        onClick={handleTokenRefresh} 
                        disabled={loading || !refreshToken}
                        className="refresh-button"
                      >
                        🔄 Refresh Token to Access
                      </button>
                    ) : getTokenStatus() === 'expiring_soon' ? (
                      <button 
                        onClick={handleTokenRefresh} 
                        disabled={loading || !refreshToken}
                        className="refresh-button"
                      >
                        🔄 Refresh Token (Expiring Soon)
                      </button>
                    ) : (
                      <div className="account-status">
                        <span className="status-active">✅ Active & Accessible</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {getTokenStatus() === 'expired' && (
              <div className="token-expired-notice">
                <p>⚠️ Your access token has expired. Please refresh your token to access account data and manage locations.</p>
              </div>
            )}
          </div>
        )}

        {/* Locations Table Section */}
        {allLocations.length > 0 && (
          <div className="section">
            <h2>All Business Locations ({allLocations.length})</h2>
            {getTokenStatus() === 'expired' && (
              <div className="token-expired-notice">
                <p>⚠️ Token expired! Please refresh your token above to save outlet codes and access reviews.</p>
              </div>
            )}
            <div className="locations-table-container">
              <table className="locations-table">
                <thead>
                  <tr>
                    <th>Account ID</th>
                    <th>Account Name</th>
                    <th>Location Name</th>
                    <th>Address</th>
                    <th>Maps URI</th>
                    <th>Review URI</th>
                    <th>Outlet Code</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allLocations.map((location, index) => {
                    const key = `${location.account_id}_${location.location_id}`;
                    const accountId = location.account_id.replace('accounts/', '');
                    const locationId = location.location_id.replace('locations/', '').split('/').pop();
                    
                    return (
                      <tr key={index}>
                        <td className="account-id">{accountId}</td>
                        <td>{location.account_name || 'N/A'}</td>
                        <td>{location.title || 'N/A'}</td>
                        <td>{location.address || 'N/A'}</td>
                        <td>
                          {location.maps_uri ? (
                            <a 
                              href={location.maps_uri} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="uri-link"
                              title="Open in Google Maps"
                            >
                              📍 Maps
                            </a>
                          ) : (
                            'N/A'
                          )}
                        </td>
                        <td>
                          {location.new_review_uri ? (
                            <a 
                              href={location.new_review_uri} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="uri-link"
                              title="Write a review"
                            >
                              ⭐ Review
                            </a>
                          ) : (
                            'N/A'
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={outletCodes[key] || ''}
                            onChange={(e) => handleOutletCodeChange(location.account_id, location.location_id, e.target.value)}
                            placeholder="Enter outlet code"
                            className="outlet-code-input"
                          />
                        </td>
                        <td>
                          <button
                            onClick={() => saveOutletCode(location.account_id, location.location_id)}
                            disabled={loading || getTokenStatus() === 'expired'}
                            className="save-outlet-button"
                            title={getTokenStatus() === 'expired' ? 'Please refresh your token first' : 'Save outlet code'}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => handleGetReviews(location.account_id, location.location_id)}
                            disabled={loading || getTokenStatus() === 'expired'}
                            className="reviews-button"
                            title={getTokenStatus() === 'expired' ? 'Please refresh your token first' : 'View reviews'}
                          >
                            Reviews
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Reviews Section */}
        {reviews.length > 0 && (
          <div className="section">
            <h2>Reviews ({reviews.length})</h2>
            <div className="reviews-container">
            {reviews.map(review => (
                <div key={review.reviewId || review.name} className="review-card">
                  <div className="review-header">
                    <strong>{review.reviewer?.displayName || 'Anonymous'}</strong>
                    <div className="rating">
                      {'★'.repeat(review.starRating || 0)}{'☆'.repeat(5 - (review.starRating || 0))}
                      <span className="rating-number">({review.starRating || 0}/5)</span>
                    </div>
                    <div className="review-date">
                      {review.createTime ? new Date(review.createTime).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                  
                  <div className="review-content">
                    <p>{review.comment || 'No comment provided'}</p>
                  </div>
                  
                  {review.reviewReply && (
                    <div className="existing-reply">
                      <strong>Your Reply:</strong>
                      <p>{review.reviewReply.comment}</p>
                      <small>Replied on: {new Date(review.reviewReply.updateTime).toLocaleDateString()}</small>
                    </div>
                  )}
                  
                <div className="reply-section">
                  <textarea
                    placeholder="Write a reply..."
                    value={replyText[review.name] || ''}
                    onChange={(e) => handleReplyTextChange(review.name, e.target.value)}
                      className="reply-textarea"
                      rows="3"
                    />
                    <button 
                      onClick={() => handleReplyToReview(review.name)}
                      disabled={loading || !replyText[review.name]}
                      className="reply-button"
                    >
                      {review.reviewReply ? 'Update Reply' : 'Send Reply'}
                    </button>
                  </div>
                </div>
              ))}
                </div>
              </div>
        )}

        {/* No Reviews Message */}
        {selectedLocation && reviews.length === 0 && !loading && (
          <div className="section">
            <p>No reviews found for this location.</p>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { db, initDatabase, getOrCreateUser, saveTokens, getTokens, updateAccessToken, saveAccounts, getAccounts, saveLocations, getLocations, getAllLocations, updateOutletCode, getAllUsers } = require('./database');
const app = express();
const port = process.env.PORT || 8011;

app.use(cors());
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Initialize database
initDatabase().then(() => {
  console.log('Database initialized successfully');
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// OAuth 2.0 Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'your_google_client_id_here';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'your_google_client_secret_here';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8011/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SCOPE = 'https://www.googleapis.com/auth/business.manage openid email profile';

// Helper function to make requests to Google APIs
const makeGoogleAPIRequest = async (url, token, method = 'GET', body = null) => {
  const fetch = (await import('node-fetch')).default;
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };
  
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  // Check if response is JSON
  const contentType = response.headers.get('content-type');
  let data;
  
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { error: `Non-JSON response: ${text}` };
  }
  
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }
  
  return data;
};

// Helper function to get user info from Google
const getUserInfo = async (token) => {
  const fetch = (await import('node-fetch')).default;
  
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('User info request failed:', response.status, errorText);
    throw new Error(`Failed to get user info: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
};

// Helper function to auto-fetch accounts and locations
const autoFetchAccountsAndLocations = async (userId, token) => {
  try {
    // Fetch accounts
    const accountsData = await makeGoogleAPIRequest(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      token
    );
    
    const accounts = accountsData.accounts || [];
    await saveAccounts(userId, accounts);
    
    // Fetch locations for each account
    for (const account of accounts) {
      try {
                  const readMask = 'storeCode,name,title,phoneNumbers,labels,storefrontAddress,metadata';
        
        // Extract account ID from account.name (removes "accounts/" prefix)
        const accountId = account.name.replace('accounts/', '');
        
        // Use pagination to fetch all locations for this account
        const locationsData = await fetchAllLocations(accountId, token, readMask);
        
        const locations = locationsData.locations || [];
        await saveLocations(userId, accountId, locations);
      } catch (locationError) {
        console.error(`Error fetching locations for account ${account.name}:`, locationError);
        // Continue with other accounts even if one fails
      }
    }
    
    return { accounts, success: true };
  } catch (error) {
    console.error('Error in auto-fetch:', error);
    return { accounts: [], success: false, error: error.message };
  }
};

// Root endpoint
app.get('/', (req, res) => {
  res.send('Google Business Profile API Backend');
});

// OAuth 2.0 Endpoints

// Generate OAuth URL
app.get('/auth/google/url', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(SCOPE)}&` +
    `response_type=code&` +
    `access_type=offline&` +
    `prompt=consent`;
  
  res.json({ authUrl });
});

// OAuth callback endpoint
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.redirect(`${FRONTEND_URL}/?error=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    return res.redirect(`${FRONTEND_URL}/?error=no_code`);
  }
  
  try {
    // Exchange code for tokens
    const fetch = (await import('node-fetch')).default;
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    
    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for tokens');
    }
    
    const tokens = await tokenResponse.json();
    
    // Get user info
    const userInfo = await getUserInfo(tokens.access_token);
    
    // Create or update user in database
    const user = await getOrCreateUser({
      user_id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name
    });
    
    // Save tokens to database
    await saveTokens(user.user_id, tokens.access_token, tokens.refresh_token, tokens.expires_in);
    
    // Auto-fetch accounts and locations
    const autoFetchResult = await autoFetchAccountsAndLocations(user.user_id, tokens.access_token);
    
    // Redirect back to frontend with tokens and user info
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expires_in: tokens.expires_in,
      user_id: user.user_id,
      user_email: userInfo.email,
      user_name: userInfo.name,
      auto_fetch_success: autoFetchResult.success
    });
    
    res.redirect(`${FRONTEND_URL}/?${params.toString()}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/?error=${encodeURIComponent('token_exchange_failed')}`);
  }
});

// Refresh token endpoint
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refresh_token, user_id } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({ 
        error: 'Refresh token is required',
        code: 'MISSING_REFRESH_TOKEN'
      });
    }
    
    const fetch = (await import('node-fetch')).default;
    
    console.log('Refreshing token...');
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    
    const responseData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('Token refresh failed:', responseData);
      
      // Check if refresh token is invalid/expired
      if (responseData.error === 'invalid_grant') {
        return res.status(401).json({ 
          error: 'Refresh token is invalid or expired. Please login again.',
          code: 'INVALID_REFRESH_TOKEN',
          details: responseData
        });
      }
      
      return res.status(tokenResponse.status).json({ 
        error: 'Failed to refresh token',
        code: 'REFRESH_FAILED',
        details: responseData
      });
    }
    
    console.log('Token refreshed successfully');
    
    // Update access token in database if user_id is provided
    if (user_id && responseData.expires_in) {
      try {
        await updateAccessToken(user_id, responseData.access_token, responseData.expires_in);
      } catch (dbError) {
        console.error('Failed to update token in database:', dbError);
      }
    }
    
    // Add refresh timestamp
    responseData.refreshed_at = new Date().toISOString();
    
    res.json(responseData);
    
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ 
      error: 'Failed to refresh token', 
      code: 'SERVER_ERROR',
      details: error.message 
    });
  }
});

// Get stored accounts from database
app.get('/api/accounts/stored/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const accounts = await getAccounts(userId);
    
    // Transform to match the frontend expected format
    const formattedAccounts = accounts.map(account => ({
      name: account.account_id,
      accountName: account.account_name,
      type: account.account_type
    }));
    
    res.json({ accounts: formattedAccounts });
  } catch (error) {
    console.error('Error fetching stored accounts:', error);
    res.status(500).json({ error: 'Failed to fetch stored accounts', details: error.message });
  }
});

// Get Accounts (original endpoint - now also stores in DB)
app.get('/api/accounts', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = req.headers['x-user-id'];
    
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const data = await makeGoogleAPIRequest(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      token
    );
    
    // Store accounts in database if userId is provided
    if (userId && data.accounts) {
      try {
        await saveAccounts(userId, data.accounts);
      } catch (dbError) {
        console.error('Failed to save accounts to database:', dbError);
      }
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts', details: error.message });
  }
});

// Get all locations for a user (across all accounts)
app.get('/api/locations/all/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const locations = await getAllLocations(userId);
    
    res.json({ locations });
  } catch (error) {
    console.error('Error fetching all locations:', error);
    res.status(500).json({ error: 'Failed to fetch all locations', details: error.message });
  }
});

// Get stored locations from database
app.get('/api/accounts/:accountId/locations/stored/:userId', async (req, res) => {
  try {
    const { accountId, userId } = req.params;
    
    if (!userId || !accountId) {
      return res.status(400).json({ error: 'User ID and Account ID are required' });
    }

    const locations = await getLocations(userId, accountId);
    
    // Transform to match the frontend expected format
    const formattedLocations = locations.map(location => ({
      name: location.location_id,
      title: location.title,
      storefrontAddress: {
        locality: location.address ? location.address.split(',')[0] : '',
        administrativeArea: location.address ? location.address.split(',')[1] : ''
      }
    }));
    
    res.json({ locations: formattedLocations });
  } catch (error) {
    console.error('Error fetching stored locations:', error);
    res.status(500).json({ error: 'Failed to fetch stored locations', details: error.message });
  }
});

// Helper function to fetch all locations with pagination
const fetchAllLocations = async (accountId, token, readMask) => {
  const allLocations = [];
  let nextPageToken = null;
  
  do {
    let url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?read_mask=${encodeURIComponent(readMask)}`;
    
    // Add pageToken parameter if we have one
    if (nextPageToken) {
      url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
    }
    
    const data = await makeGoogleAPIRequest(url, token);
    
    // Add locations from this page to our collection
    if (data.locations) {
      allLocations.push(...data.locations);
    }
    
    // Update nextPageToken for next iteration
    nextPageToken = data.nextPageToken || null;
    
    console.log(`Fetched ${data.locations ? data.locations.length : 0} locations from page. Total so far: ${allLocations.length}. Next page token: ${nextPageToken ? 'exists' : 'none'}`);
    
  } while (nextPageToken);
  
  return {
    locations: allLocations,
    totalCount: allLocations.length
  };
};

// Get Locations (original endpoint - now also stores in DB)
app.get('/api/accounts/:accountId/locations', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = req.headers['x-user-id'];
    
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { accountId } = req.params;
    const readMask = 'storeCode,regularHours,name,languageCode,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,labels,adWordsLocationExtensions,latlng,openInfo,metadata,profile,relationshipData,moreHours';
    
    // Fetch all locations with pagination
    const data = await fetchAllLocations(accountId, token, readMask);
    
    // Store locations in database if userId is provided
    if (userId && data.locations) {
      try {
        await saveLocations(userId, accountId, data.locations);
      } catch (dbError) {
        console.error('Failed to save locations to database:', dbError);
      }
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations', details: error.message });
  }
});

// Helper function to fetch all reviews with pagination
const fetchAllReviews = async (accountId, locationId, token) => {
  const allReviews = [];
  let nextPageToken = null;
  
  do {
    let url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
    
    // Add pageToken parameter if we have one
    if (nextPageToken) {
      url += `?pageToken=${encodeURIComponent(nextPageToken)}`;
    }
    
    const data = await makeGoogleAPIRequest(url, token);
    
    // Add reviews from this page to our collection
    if (data.reviews) {
      allReviews.push(...data.reviews);
    }
    
    // Update nextPageToken for next iteration
    nextPageToken = data.nextPageToken || null;
    
    console.log(`Fetched ${data.reviews ? data.reviews.length : 0} reviews from page. Total so far: ${allReviews.length}. Next page token: ${nextPageToken ? 'exists' : 'none'}`);
    
  } while (nextPageToken);
  
  return {
    reviews: allReviews,
    totalCount: allReviews.length
  };
};

// Get Reviews
app.get('/api/accounts/:accountId/locations/:locationId/reviews', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { accountId, locationId } = req.params;
    
    // Fetch all reviews with pagination
    const data = await fetchAllReviews(accountId, locationId, token);
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews', details: error.message });
  }
});

// Reply to Review
app.put('/api/accounts/:accountId/locations/:locationId/reviews/:reviewId/reply', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { accountId, locationId, reviewId } = req.params;
    const { comment } = req.body;
    
    if (!comment) {
      return res.status(400).json({ error: 'Comment is required' });
    }
    
    const data = await makeGoogleAPIRequest(
      `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`,
      token,
      'PUT',
      { comment }
    );
    
    res.json(data);
  } catch (error) {
    console.error('Error replying to review:', error);
    res.status(500).json({ error: 'Failed to reply to review', details: error.message });
  }
});

// Get all authenticated users
app.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// Get user tokens
app.get('/api/user/:userId/tokens', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    const tokens = await getTokens(userId);
    
    if (!tokens) {
      return res.status(404).json({ error: 'No tokens found for this user' });
    }
    
    res.json({ 
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at
      }
    });
  } catch (error) {
    console.error('Error fetching user tokens:', error);
    res.status(500).json({ error: 'Failed to fetch user tokens', details: error.message });
  }
});

// Update outlet code for a location
app.put('/api/locations/outlet-code', async (req, res) => {
  try {
    const { userId, accountId, locationId, outletCode } = req.body;
    
    if (!userId || !accountId || !locationId) {
      return res.status(400).json({ error: 'User ID, Account ID, and Location ID are required' });
    }
    
    const result = await updateOutletCode(userId, accountId, locationId, outletCode);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    res.json({ success: true, message: 'Outlet code updated successfully' });
  } catch (error) {
    console.error('Error updating outlet code:', error);
    res.status(500).json({ error: 'Failed to update outlet code', details: error.message });
  }
});

// Reports Authentication
app.post('/api/reports/authenticate', (req, res) => {
  const { password } = req.body;
  
  if (password === 'Jakarta2025') {
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Get all locations for reports (password protected)
app.get('/api/reports/locations', async (req, res) => {
  try {
    const { password } = req.headers;
    
    if (password !== 'Jakarta2025') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all locations across all users
    const locations = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          l.*,
          u.email as user_email,
          u.name as user_name,
          a.account_name,
          a.account_type
        FROM locations l
        LEFT JOIN users u ON l.user_id = u.user_id
        LEFT JOIN accounts a ON l.user_id = a.user_id AND l.account_id = a.account_id
        ORDER BY u.email, a.account_name, l.title
      `, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
    
    res.json({ locations, total: locations.length });
  } catch (error) {
    console.error('Error fetching report locations:', error);
    res.status(500).json({ error: 'Failed to fetch report locations', details: error.message });
  }
});

// Get statistics for reports (password protected)
app.get('/api/reports/statistics', async (req, res) => {
  try {
    const { password } = req.headers;
    
    if (password !== 'Jakarta2025') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get various statistics
    const stats = await new Promise((resolve, reject) => {
      const statistics = {};
      
      // Total users
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        statistics.totalUsers = row.count;
        
        // Total accounts
        db.get('SELECT COUNT(*) as count FROM accounts', [], (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          statistics.totalAccounts = row.count;
          
          // Total locations
          db.get('SELECT COUNT(*) as count FROM locations', [], (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            statistics.totalLocations = row.count;
            
            // Locations with outlet codes
            db.get('SELECT COUNT(*) as count FROM locations WHERE outlet_code IS NOT NULL AND outlet_code != ""', [], (err, row) => {
              if (err) {
                reject(err);
                return;
              }
              statistics.locationsWithOutletCodes = row.count;
              
              // Locations by user
              db.all(`
                SELECT 
                  u.email,
                  u.name,
                  COUNT(l.id) as location_count
                FROM users u
                LEFT JOIN locations l ON u.user_id = l.user_id
                GROUP BY u.user_id, u.email, u.name
                ORDER BY location_count DESC
              `, [], (err, rows) => {
                if (err) {
                  reject(err);
                  return;
                }
                statistics.locationsByUser = rows;
                
                // Recent activity (users created in last 30 days)
                db.get(`
                  SELECT COUNT(*) as count 
                  FROM users 
                  WHERE created_at >= datetime('now', '-30 days')
                `, [], (err, row) => {
                  if (err) {
                    reject(err);
                    return;
                  }
                  statistics.recentNewUsers = row.count;
                  resolve(statistics);
                });
              });
            });
          });
        });
      });
    });
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching report statistics:', error);
    res.status(500).json({ error: 'Failed to fetch report statistics', details: error.message });
  }
});

// Export all locations to CSV (password protected)
app.get('/api/reports/export/csv', async (req, res) => {
  try {
    const { password } = req.headers;
    
    if (password !== 'Jakarta2025') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all locations with user information
    const locations = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          u.email as user_email,
          u.name as user_name,
          a.account_name,
          a.account_type,
          l.account_id,
          l.location_id,
          l.location_name,
          l.title,
          l.address,
          l.outlet_code,
          l.maps_uri,
          l.new_review_uri,
          l.created_at,
          l.updated_at
        FROM locations l
        LEFT JOIN users u ON l.user_id = u.user_id
        LEFT JOIN accounts a ON l.user_id = a.user_id AND l.account_id = a.account_id
        ORDER BY u.email, a.account_name, l.title
      `, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
    
    if (!locations || locations.length === 0) {
      return res.status(404).json({ error: 'No locations found for export' });
    }

    // Create CSV content with comprehensive headers
    const csvHeaders = [
      'User Email', 'User Name', 'Account Name', 'Account Type', 'Account ID', 
      'Location ID', 'Location Name', 'Title', 'Address', 'Outlet Code',
      'Maps URI', 'Review URI', 'Created At', 'Updated At'
    ];
    
    const csvRows = locations.map(location => [
      location.user_email || '',
      location.user_name || '',
      location.account_name || '',
      location.account_type || '',
      location.account_id || '',
      location.location_id || '',
      location.location_name || '',
      location.title || '',
      location.address || '',
      location.outlet_code || '',
      location.maps_uri || '',
      location.new_review_uri || '',
      location.created_at || '',
      location.updated_at || ''
    ]);
    
    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="all_locations_report_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting report CSV:', error);
    res.status(500).json({ error: 'Failed to export report CSV', details: error.message });
  }
});

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📱 Frontend and backend both accessible on port ${port}`);
}); 
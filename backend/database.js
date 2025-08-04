const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'tokens.db');
const db = new sqlite3.Database(dbPath);

// Initialize database schema
const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create users table to store user information
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        email TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Error creating users table:', err);
          reject(err);
          return;
        }
      });

      // Create tokens table to store OAuth tokens
      db.run(`CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id)
      )`, (err) => {
        if (err) {
          console.error('Error creating tokens table:', err);
          reject(err);
          return;
        }
      });

      // Create accounts table to store Google Business accounts
      db.run(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT,
        account_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id),
        UNIQUE(user_id, account_id)
      )`, (err) => {
        if (err) {
          console.error('Error creating accounts table:', err);
          reject(err);
          return;
        }
      });

      // Create locations table to store business locations
      db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        location_name TEXT,
        title TEXT,
        address TEXT,
        outlet_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id),
        UNIQUE(user_id, account_id, location_id)
      )`, (err) => {
        if (err) {
          console.error('Error creating locations table:', err);
          reject(err);
          return;
        }
        
        // Migration: Add outlet_code column if it doesn't exist
        db.run(`ALTER TABLE locations ADD COLUMN outlet_code TEXT`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding outlet_code column:', err);
          } else if (!err) {
            console.log('Added outlet_code column to locations table');
          }
          
          // Migration: Add mapsUri column if it doesn't exist
          db.run(`ALTER TABLE locations ADD COLUMN maps_uri TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding maps_uri column:', err);
            } else if (!err) {
              console.log('Added maps_uri column to locations table');
            }
            
            // Migration: Add newReviewUri column if it doesn't exist
            db.run(`ALTER TABLE locations ADD COLUMN new_review_uri TEXT`, (err) => {
              if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding new_review_uri column:', err);
              } else if (!err) {
                console.log('Added new_review_uri column to locations table');
              }
              resolve();
            });
          });
        });
      });
    });
  });
};

// User management functions
const getOrCreateUser = (userInfo) => {
  return new Promise((resolve, reject) => {
    const { user_id, email, name } = userInfo;
    
    // Try to get existing user
    db.get('SELECT * FROM users WHERE user_id = ?', [user_id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (row) {
        // Update existing user
        db.run('UPDATE users SET email = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', 
          [email, name, user_id], (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(row);
          });
      } else {
        // Create new user
        db.run('INSERT INTO users (user_id, email, name) VALUES (?, ?, ?)', 
          [user_id, email, name], function(err) {
            if (err) {
              reject(err);
              return;
            }
            resolve({ id: this.lastID, user_id, email, name });
          });
      }
    });
  });
};

// Token management functions
const saveTokens = (userId, accessToken, refreshToken, expiresIn) => {
  return new Promise((resolve, reject) => {
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));
    
    // Delete existing tokens for this user
    db.run('DELETE FROM tokens WHERE user_id = ?', [userId], (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Insert new tokens
      db.run('INSERT INTO tokens (user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)', 
        [userId, accessToken, refreshToken, expiresAt.toISOString()], function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({ id: this.lastID, user_id: userId, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt });
        });
    });
  });
};

const getTokens = (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
};

const updateAccessToken = (userId, accessToken, expiresIn) => {
  return new Promise((resolve, reject) => {
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));
    
    db.run('UPDATE tokens SET access_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', 
      [accessToken, expiresAt.toISOString(), userId], (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
  });
};

// Account management functions
const saveAccounts = (userId, accounts) => {
  return new Promise((resolve, reject) => {
    // Delete existing accounts for this user
    db.run('DELETE FROM accounts WHERE user_id = ?', [userId], (err) => {
      if (err) {
        reject(err);
        return;
      }

      if (!accounts || accounts.length === 0) {
        resolve([]);
        return;
      }

      // Insert new accounts
      const stmt = db.prepare('INSERT OR REPLACE INTO accounts (user_id, account_id, account_name, account_type) VALUES (?, ?, ?, ?)');
      
      accounts.forEach(account => {
        stmt.run([userId, account.name, account.accountName, account.type]);
      });
      
      stmt.finalize((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(accounts);
      });
    });
  });
};

const getAccounts = (userId) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM accounts WHERE user_id = ?', [userId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
};

// Location management functions
const saveLocations = (userId, accountId, locations) => {
  return new Promise((resolve, reject) => {
    // Delete existing locations for this account
    db.run('DELETE FROM locations WHERE user_id = ? AND account_id = ?', [userId, accountId], (err) => {
      if (err) {
        reject(err);
        return;
      }

      if (!locations || locations.length === 0) {
        resolve([]);
        return;
      }

      // Insert new locations
      const stmt = db.prepare('INSERT OR REPLACE INTO locations (user_id, account_id, location_id, location_name, title, address, outlet_code, maps_uri, new_review_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      
      locations.forEach(location => {
        const address = location.storefrontAddress ? 
          `${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''}`.trim() : '';
        
        // Extract URIs from metadata
        const mapsUri = location.metadata?.mapsUri || null;
        const newReviewUri = location.metadata?.newReviewUri || null;
        
        stmt.run([userId, accountId, location.name, location.name, location.title, address, location.outlet_code || null, mapsUri, newReviewUri]);
      });
      
      stmt.finalize((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(locations);
      });
    });
  });
};

const getLocations = (userId, accountId) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM locations WHERE user_id = ? AND account_id = ?', [userId, accountId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
};

// Get all locations for a user across all accounts
const getAllLocations = (userId) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT l.*, a.account_name, a.account_type 
      FROM locations l 
      LEFT JOIN accounts a ON l.user_id = a.user_id AND l.account_id = a.account_id 
      WHERE l.user_id = ? 
      ORDER BY a.account_name, l.title
    `, [userId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
};

// Update outlet code for a specific location
const updateOutletCode = (userId, accountId, locationId, outletCode) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE locations SET outlet_code = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND account_id = ? AND location_id = ?',
      [outletCode, userId, accountId, locationId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ changes: this.changes });
      }
    );
  });
};

// Get all users from the database
const getAllUsers = () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY updated_at DESC', (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
};

module.exports = {
  db,
  initDatabase,
  getOrCreateUser,
  saveTokens,
  getTokens,
  updateAccessToken,
  saveAccounts,
  getAccounts,
  saveLocations,
  getLocations,
  getAllLocations,
  updateOutletCode,
  getAllUsers
};
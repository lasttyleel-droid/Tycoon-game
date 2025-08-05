const filePath = 'C:\Users\Ian S\Desktop\Tycoon.IO'; // Windows
// or on Linux/Mac
const filePath = 'C:\Users\Ian S\Desktop\Tycoon.IO';


const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;

// ---- Simple in-memory DB ---- //
let players = {};
let stocks = [];
const WEEKLY_ALLOWANCE = 200;
const WEEKS_IN_40_YEARS = 2080;
const INDEX_FUND_WEEKLY_GROWTH = 0.0015; // ~8% annual

// Business and Real Estate data
let businesses = {};
let realEstates = {};

// Stripe stub (replace with your keys and real code)
const STRIPE_SECRET_KEY = 'sk_test_replace_with_real_key';
const stripe = require('stripe')(STRIPE_SECRET_KEY);

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// ---- Fantasy Stocks Initialization ---- //
function generateFantasyStocks() {
  const baseStocks = [
    { ticker: 'SOLC', name: 'SolarCorp', sector: 'Energy', price: 20, volatility: 0.05, growthTrend: 0.002 },
    { ticker: 'NEUR', name: 'NeuroTech', sector: 'Tech', price: 15, volatility: 0.07, growthTrend: 0.003 },
    { ticker: 'BIOC', name: 'BioMedCo', sector: 'Healthcare', price: 12, volatility: 0.06, growthTrend: 0.002 },
    { ticker: 'FOOD', name: 'Snack Empire', sector: 'Retail', price: 10, volatility: 0.04, growthTrend: 0.001 },
    { ticker: 'RENT', name: 'RentAll', sector: 'Real Estate', price: 25, volatility: 0.03, growthTrend: 0.002 },
  ];
  return baseStocks;
}
stocks = generateFantasyStocks();

// ---- Stock price simulation (1 sec = 1 day) ---- //
function updateStockPrices() {
  stocks.forEach(stock => {
    const volatility = (Math.random() - 0.5) * stock.volatility;
    stock.price = Math.max(1, stock.price * (1 + volatility + stock.growthTrend));
    stock.price = +stock.price.toFixed(2);
  });
}

// ---- Player structure ---- //
function createNewPlayer(id) {
  return {
    id,
    cashBalance: 0,
    portfolio: {}, // ticker => shares
    weeksPlayed: 0,
    jailed: false,
    jailTimeLeft: 0,
    indexFundBalance: 0,
    indexFundEnabled: false,
    insiderUsage: 0,
    isPremium: false,
    businesses: {}, // businessId => business object
    realEstates: {}, // realEstateId => property object
    netWorth: 0,
  };
}

// ---- Helper functions ---- //
function calculatePortfolioValue(player) {
  let value = 0;
  for (const [ticker, shares] of Object.entries(player.portfolio)) {
    const stock = stocks.find(s => s.ticker === ticker);
    if (stock) value += shares * stock.price;
  }
  return value;
}

function calculateNetWorth(player) {
  const portfolioValue = calculatePortfolioValue(player);
  let businessValue = 0;
  for (const b of Object.values(player.businesses)) {
    businessValue += b.value;
  }
  let realEstateValue = 0;
  for (const r of Object.values(player.realEstates)) {
    realEstateValue += r.value;
  }
  return player.cashBalance + portfolioValue + businessValue + realEstateValue + player.indexFundBalance;
}

// ---- Redistribute liquidated portfolio ---- //
function redistributeFunds(amount, excludePlayerId) {
  const otherPlayers = Object.values(players).filter(p => p.id !== excludePlayerId);
  if (otherPlayers.length === 0) return;

  const share = amount / otherPlayers.length;
  otherPlayers.forEach(p => {
    p.cashBalance += share;
  });
}

// ---- Insider investigation logic ---- //
function checkInsiderAbuse(player) {
  const suspicionThreshold = 5;
  if (player.insiderUsage >= suspicionThreshold) {
    // Caught
    handleInsiderCatch(player);
  }
}

function handleInsiderCatch(player) {
  if (player.jailed) return; // Already jailed
  // Liquidate portfolio
  const portfolioValue = calculatePortfolioValue(player);
  player.portfolio = {};
  player.cashBalance = 0;

  // Redistribute portfolio value to others
  redistributeFunds(portfolioValue, player.id);

  // Jail player
  player.jailed = true;
  player.jailTimeLeft = 520; // 10 years (in weeks)
  player.insiderUsage = 0;

  // Optionally reset index fund
  player.indexFundBalance = 0;
  player.indexFundEnabled = false;

  io.to(player.id).emit('jailed', { message: 'You were caught abusing insider info! Your portfolio was liquidated and redistributed. You are jailed for 10 years.' });
}

// ---- Weekly allowance & index fund compounding ---- //
function weeklyUpdate() {
  Object.values(players).forEach(player => {
    if (player.weeksPlayed >= WEEKS_IN_40_YEARS) return; // max time reached

    // Add weekly allowance
    if (!player.jailed) {
      player.cashBalance += WEEKLY_ALLOWANCE;
    } else {
      if (player.indexFundEnabled) {
        // Compound index fund balance + add weekly allowance
        player.indexFundBalance *= (1 + INDEX_FUND_WEEKLY_GROWTH);
        player.indexFundBalance += WEEKLY_ALLOWANCE;
      } else {
        // Just add to cash while jailed
        player.cashBalance += WEEKLY_ALLOWANCE;
      }

      // Decrement jail time
      player.jailTimeLeft--;
      if (player.jailTimeLeft <= 0) {
        player.jailed = false;
        player.jailTimeLeft = 0;

        // Release index fund balance to cash
        player.cashBalance += player.indexFundBalance;
        player.indexFundBalance = 0;
        player.indexFundEnabled = false;

        io.to(player.id).emit('released', { message: 'You are released from jail! Your index fund has matured.' });
      }
    }

    player.weeksPlayed++;
    player.netWorth = calculateNetWorth(player);
  });
}

// ---- Business & Real Estate Placeholder ---- //
function updateBusinessesAndRealEstate() {
  Object.values(players).forEach(player => {
    // Businesses generate profit
    for (const b of Object.values(player.businesses)) {
      // Profit = revenue - expenses
      const profit = b.revenuePerWeek - b.expensesPerWeek;
      player.cashBalance += profit;
      // Optional: business value grows with upgrades or time
      b.value *= (1 + 0.002);
    }

    // Real Estate generates rent minus vacancy
    for (const r of Object.values(player.realEstates)) {
      const rentIncome = r.rentPerWeek * (1 - r.vacancyRate);
      player.cashBalance += rentIncome;
      r.value *= (1 + 0.001);
    }
  });
}

// ---- Socket.io ---- //
io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  // Create new player if not exist
  if (!players[socket.id]) players[socket.id] = createNewPlayer(socket.id);

  // Send initial state
  socket.emit('init', {
    stocks,
    player: players[socket.id],
  });

  // Handle buy stock
  socket.on('buyStock', ({ ticker, shares }) => {
    const player = players[socket.id];
    if (player.jailed) {
      socket.emit('error', 'You are jailed and cannot trade.');
      return;
    }
    const stock = stocks.find(s => s.ticker === ticker);
    if (!stock) return;
    const cost = stock.price * shares;
    if (cost > player.cashBalance) {
      socket.emit('error', 'Insufficient funds.');
      return;
    }
    player.cashBalance -= cost;
    player.portfolio[ticker] = (player.portfolio[ticker] || 0) + shares;
    player.netWorth = calculateNetWorth(player);
    io.emit('playerUpdate', player);
  });

  // Handle sell stock
  socket.on('sellStock', ({ ticker, shares }) => {
    const player = players[socket.id];
    if (player.jailed) {
      socket.emit('error', 'You are jailed and cannot trade.');
      return;
    }
    const stock = stocks.find(s => s.ticker === ticker);
    if (!stock) return;
    if (!player.portfolio[ticker] || player.portfolio[ticker] < shares) {
      socket.emit('error', 'Not enough shares.');
      return;
    }
    player.portfolio[ticker] -= shares;
    player.cashBalance += stock.price * shares;
    player.netWorth = calculateNetWorth(player);
    io.emit('playerUpdate', player);
  });

  // Handle insider info usage (premium only)
  socket.on('useInsiderInfo', () => {
    const player = players[socket.id];
    if (!player.isPremium) {
      socket.emit('error', 'Insider info available to premium players only.');
      return;
    }
    if (player.jailed) {
      socket.emit('error', 'You are jailed and cannot use insider info.');
      return;
    }
    player.insiderUsage++;
    // Simulate some insider tip (in a real game, you'd send real hints)
    socket.emit('insiderTip', { message: 'Tech sector expected to rise 8% next week.' });
    checkInsiderAbuse(player);
  });

  // Handle toggle index fund for jailed players
  socket.on('toggleIndexFund', (enabled) => {
    const player = players[socket.id];
    if (!player.jailed) {
      socket.emit('error', 'Index fund only available while jailed.');
      return;
    }
    player.indexFundEnabled = enabled;
    socket.emit('indexFundStatus', { enabled });
  });

  // Placeholder for buying businesses / real estate (premium)
  socket.on('buyBusiness', (businessData) => {
    const player = players[socket.id];
    if (!player.isPremium) {
      socket.emit('error', 'Business building is a premium feature.');
      return;
    }
    // Validate and add business
    const cost = businessData.cost || 10000;
    if (player.cashBalance < cost) {
      socket.emit('error', 'Insufficient funds for business.');
      return;
    }
    const businessId = 'bus_' + Date.now();
    player.cashBalance -= cost;
    player.businesses[businessId] = {
      ...businessData,
      id: businessId,
      ownerId: player.id,
      value: cost,
      revenuePerWeek: businessData.revenuePerWeek || 500,
      expensesPerWeek: businessData.expensesPerWeek || 200,
    };
    player.netWorth = calculateNetWorth(player);
    socket.emit('businessBought', player.businesses[businessId]);
  });

  socket.on('buyRealEstate', (realEstateData) => {
    const player = players[socket.id];
    if (!player.isPremium) {
      socket.emit('error', 'Real estate investing is a premium feature.');
      return;
    }
    const cost = realEstateData.price || 50000;
    if (player.cashBalance < cost) {
      socket.emit('error', 'Insufficient funds for real estate.');
      return;
    }
    const realEstateId = 're_' + Date.now();
    player.cashBalance -= cost;
    player.realEstates[realEstateId] = {
      ...realEstateData,
      id: realEstateId,
      ownerId: player.id,
      rentPerWeek: realEstateData.rentPerWeek || (cost * 0.0015), // ~8% annual
      vacancyRate: realEstateData.vacancyRate || 0.1,
      value: cost,
    };
    player.netWorth = calculateNetWorth(player);
    socket.emit('realEstateBought', player.realEstates[realEstateId]);
  });

  // Handle premium upgrade (stub)
  socket.on('upgradeToPremium', () => {
    // Here you would integrate real Stripe payment confirmation
    players[socket.id].isPremium = true;
    socket.emit('premiumStatus', { isPremium: true });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

// ---- Periodic updates ---- //
setInterval(() => {
  updateStockPrices();
  weeklyUpdate();
  updateBusinessesAndRealEstate();
  io.emit('stocksUpdate', stocks);
  io.emit('playersUpdate', Object.values(players));
}, 1000); // 1 second = 1 day

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

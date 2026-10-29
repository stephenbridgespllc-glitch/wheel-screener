// Live data layer shared by Wheel Screener + Stock Valuation.
// Sources: Financial Modeling Prep (direct w/ browser key, or via proxy /fmp), SEC EDGAR (via proxy /sec),
// Tradier (via proxy /tradier). Missing values resolve to null and render as n/a.
(function () {
  var SKEY = 'wheel_live_settings_v1';
  var DAY = 864e5;

  var DEFAULT_PROXY = 'https://wheel-data-proxy.stephenbridgespllc.workers.dev';
  function getSettings() {
    var s;
    try { s = Object.assign({ fmpKey: '', proxyUrl: '', scanLimit: 40 }, JSON.parse(localStorage.getItem(SKEY) || '{}')); }
    catch (e) { s = { fmpKey: '', proxyUrl: '', scanLimit: 40 }; }
    if (!s.proxyUrl) s.proxyUrl = DEFAULT_PROXY;
    return s;
  }
  function saveSettings(s) {
    var o = { fmpKey: String(s.fmpKey || '').trim(), proxyUrl: String(s.proxyUrl || '').trim().replace(/\/+$/, ''), scanLimit: Math.max(1, Math.min(500, parseInt(s.scanLimit, 10) || 40)) };
    localStorage.setItem(SKEY, JSON.stringify(o));
    proxyFmp = null; fmpDead = false;
    window.dispatchEvent(new Event('livedata-settings'));
    return o;
  }
  function status() { var s = getSettings(); return { fmp: !!(s.fmpKey || s.proxyUrl), proxy: !!s.proxyUrl, any: !!(s.fmpKey || s.proxyUrl) }; }

  function cget(k, maxAge) { try { var o = JSON.parse(localStorage.getItem('ld:' + k)); if (o && Date.now() - o.t < maxAge) return o.v; } catch (e) {} return undefined; }
  function cset(k, v) { try { localStorage.setItem('ld:' + k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {} }
  function clearCache() { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ld:') === 0) localStorage.removeItem(k); }); }

  function qs(params) { return Object.keys(params || {}).filter(function (k) { return params[k] != null && params[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&'); }
  async function getJson(url) {
    var r = await fetch(url);
    var text = await r.text();
    var j; try { j = JSON.parse(text); } catch (e) { throw new Error('HTTP ' + r.status + ': non-JSON response'); }
    if (!r.ok) throw new Error((j && (j.error || j['Error Message'] || j.message)) || ('HTTP ' + r.status));
    if (j && !Array.isArray(j) && j['Error Message']) throw new Error(j['Error Message']);
    return j;
  }
  function safe(p) { return p.then(function (v) { return v; }, function () { return null; }); }

  var proxyFmp = null, fmpDead = false;
  async function proxyHasFmp() {
    if (proxyFmp !== null) return proxyFmp;
    var s = getSettings(); if (!s.proxyUrl) return (proxyFmp = false);
    try { var h = await getJson(s.proxyUrl + '/health'); proxyFmp = !!h.fmp; } catch (e) { proxyFmp = false; }
    return proxyFmp;
  }
  async function fmp(path, params) {
    if (fmpDead) throw new Error(fmpDead);
    var s = getSettings();
    try {
      if (s.proxyUrl && await proxyHasFmp()) return await getJson(s.proxyUrl + '/fmp/' + path + '?' + qs(params));
      if (s.fmpKey) return await getJson('https://financialmodelingprep.com/stable/' + path + '?' + qs(Object.assign({}, params, { apikey: s.fmpKey })));
    } catch (e) {
      if (/invalid api key|limit reach/i.test(e.message)) fmpDead = /limit/i.test(e.message) ? 'FMP daily request limit reached' : 'FMP API key invalid';
      throw e;
    }
    throw new Error('FMP not configured');
  }
  function tradier(path, params) {
    var s = getSettings();
    if (!s.proxyUrl) return Promise.reject(new Error('Proxy not configured'));
    return getJson(s.proxyUrl + '/tradier/' + path + '?' + qs(params));
  }
  function sec(host, path) {
    var s = getSettings();
    if (!s.proxyUrl) return Promise.reject(new Error('Proxy not configured'));
    return getJson(s.proxyUrl + (host === 'www' ? '/sec-www/' : '/sec/') + path);
  }

  async function testConnection() {
    var s = getSettings(), out = { fmp: 'Not configured', proxy: 'Not configured', tradier: '—', sec: '—' };
    if (s.fmpKey || s.proxyUrl) {
      try { var q = await fmp('quote', { symbol: 'AAPL' }); out.fmp = Array.isArray(q) && q.length ? 'OK — AAPL ' + q[0].price : 'No data returned'; }
      catch (e) { out.fmp = 'Error: ' + e.message; }
    }
    if (s.proxyUrl) {
      try {
        var h = await getJson(s.proxyUrl + '/health');
        out.proxy = 'OK';
        out.tradier = h.tradier ? 'Token set' : 'TRADIER_TOKEN missing';
        out.sec = h.sec ? 'User-Agent set' : 'SEC_USER_AGENT missing';
        if (!s.fmpKey && !h.fmp) out.fmp = 'No browser key and FMP_KEY not set on proxy';
      } catch (e) { out.proxy = 'Error: ' + e.message; }
    }
    return out;
  }

  // ---------- Universe ----------
  var SP = 'S&P 500', NQ = 'Nasdaq-100', DJ = 'DJIA';
  var FALLBACK = [
    ['AAPL','Apple',[SP,NQ,DJ]],['MSFT','Microsoft',[SP,NQ,DJ]],['NVDA','NVIDIA',[SP,NQ,DJ]],['AMZN','Amazon',[SP,NQ,DJ]],['GOOGL','Alphabet',[SP,NQ]],['META','Meta Platforms',[SP,NQ]],
    ['BRK.B','Berkshire Hathaway',[SP]],['AVGO','Broadcom',[SP,NQ]],['TSLA','Tesla',[SP,NQ]],['LLY','Eli Lilly',[SP]],['JPM','JPMorgan Chase',[SP,DJ]],['V','Visa',[SP,DJ]],
    ['UNH','UnitedHealth',[SP,DJ]],['XOM','Exxon Mobil',[SP]],['MA','Mastercard',[SP]],['COST','Costco',[SP,NQ]],['HD','Home Depot',[SP,DJ]],['PG','Procter & Gamble',[SP,DJ]],
    ['JNJ','Johnson & Johnson',[SP,DJ]],['WMT','Walmart',[SP,DJ]],['NFLX','Netflix',[SP,NQ]],['ABBV','AbbVie',[SP]],['BAC','Bank of America',[SP]],['CRM','Salesforce',[SP,DJ]],
    ['ORCL','Oracle',[SP]],['CVX','Chevron',[SP,DJ]],['KO','Coca-Cola',[SP,DJ]],['MRK','Merck',[SP,DJ]],['AMD','Advanced Micro Devices',[SP,NQ]],['PEP','PepsiCo',[SP,NQ]],
    ['ADBE','Adobe',[SP,NQ]],['TMO','Thermo Fisher',[SP]],['LIN','Linde',[SP,NQ]],['MCD',"McDonald's",[SP,DJ]],['CSCO','Cisco',[SP,NQ,DJ]],['ACN','Accenture',[SP]],
    ['ABT','Abbott Labs',[SP]],['WFC','Wells Fargo',[SP]],['DIS','Walt Disney',[SP,DJ]],['IBM','IBM',[SP,DJ]],['QCOM','Qualcomm',[SP,NQ]],['GE','GE Aerospace',[SP]],
    ['TXN','Texas Instruments',[SP,NQ]],['INTU','Intuit',[SP,NQ]],['CAT','Caterpillar',[SP,DJ]],['AMGN','Amgen',[SP,NQ,DJ]],['VZ','Verizon',[SP]],['PFE','Pfizer',[SP]],
    ['ISRG','Intuitive Surgical',[SP,NQ]],['GS','Goldman Sachs',[SP,DJ]],['AXP','American Express',[SP,DJ]],['T','AT&T',[SP]],['MS','Morgan Stanley',[SP]],['BKNG','Booking Holdings',[SP,NQ]],
    ['UNP','Union Pacific',[SP]],['LOW',"Lowe's",[SP]],['HON','Honeywell',[SP,NQ,DJ]],['SPGI','S&P Global',[SP]],['BA','Boeing',[SP,DJ]],['NKE','Nike',[SP,DJ]],
    ['CMCSA','Comcast',[SP,NQ]],['SBUX','Starbucks',[SP,NQ]],['GILD','Gilead Sciences',[SP,NQ]],['MU','Micron',[SP,NQ]],['INTC','Intel',[SP,NQ]],['MMM','3M',[SP,DJ]],
    ['TRV','Travelers',[SP,DJ]],['SHW','Sherwin-Williams',[SP,DJ]],['PYPL','PayPal',[SP,NQ]],['MDLZ','Mondelez',[SP,NQ]],['ADP','ADP',[SP,NQ]],['PANW','Palo Alto Networks',[SP,NQ]],
    ['F','Ford Motor',[SP]],['GM','General Motors',[SP]],['C','Citigroup',[SP]],['MO','Altria',[SP]],['PM','Philip Morris',[SP]],['O','Realty Income',[SP]],
    ['PLD','Prologis',[SP]],['NEE','NextEra Energy',[SP]],['DUK','Duke Energy',[SP]],['SO','Southern Co.',[SP]],['UPS','UPS',[SP]],['TGT','Target',[SP]],
    ['CVS','CVS Health',[SP]],['BMY','Bristol-Myers Squibb',[SP]],['DE','Deere',[SP]],['LMT','Lockheed Martin',[SP]],['COP','ConocoPhillips',[SP]],['USB','U.S. Bancorp',[SP]]
  ];
  function fallbackUniverse() {
    var m = {}; FALLBACK.forEach(function (u) { m[u[0]] = { symbol: u[0], name: u[1], indices: u[2].slice() }; }); return m;
  }
  async function universe() {
    var c = cget('constituents', DAY); if (c) return { map: c, live: true };
    if (status().fmp) {
      var map = {}, got = false;
      var lists = [['sp500-constituent', SP], ['nasdaq-constituent', NQ], ['dowjones-constituent', DJ]];
      for (var i = 0; i < lists.length; i++) {
        var r = await safe(fmp(lists[i][0], {}));
        if (Array.isArray(r) && r.length) {
          got = true;
          r.forEach(function (x) { var e = map[x.symbol] || (map[x.symbol] = { symbol: x.symbol, name: x.name, sector: x.sector, indices: [] }); if (e.indices.indexOf(lists[i][1]) === -1) e.indices.push(lists[i][1]); });
        }
      }
      if (got) { cset('constituents', map); return { map: map, live: true }; }
    }
    return { map: fallbackUniverse(), live: false };
  }

  // ---------- SEC EDGAR ----------
  var CONCEPTS = {
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'],
    grossProfit: ['GrossProfit'],
    opIncome: ['OperatingIncomeLoss'],
    netIncome: ['NetIncomeLoss', 'ProfitLoss'],
    eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
    shares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
    ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    goodwill: ['Goodwill'],
    intangibles: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'],
    debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'DebtLongtermAndShorttermCombinedAmount'],
    shortDebt: ['ShortTermBorrowings', 'DebtCurrent', 'LongTermDebtCurrent'],
    cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
    dps: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
    divPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
    sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
    buyback: ['PaymentsForRepurchaseOfCommonStock'],
    assets: ['Assets'],
    curAssets: ['AssetsCurrent'],
    curLiab: ['LiabilitiesCurrent']
  };
  var INSTANT = { equity: 1, goodwill: 1, intangibles: 1, debt: 1, shortDebt: 1, cash: 1, assets: 1, curAssets: 1, curLiab: 1 };

  async function secCik(sym) {
    var m = cget('sec_tickers', 7 * DAY);
    if (!m) {
      var r = await sec('www', 'files/company_tickers.json');
      m = {}; Object.keys(r).forEach(function (k) { m[r[k].ticker] = r[k].cik_str; });
      cset('sec_tickers', m);
    }
    return m[sym] || m[sym.replace('.', '-')] || null;
  }
  function pad10(n) { return String(n).padStart(10, '0'); }

  async function secAnnual(sym) {
    var cik = await secCik(sym); if (!cik) return null;
    var facts = await sec('data', 'api/xbrl/companyfacts/CIK' + pad10(cik) + '.json');
    var g = (facts.facts && facts.facts['us-gaap']) || {};
    var years = {};
    Object.keys(CONCEPTS).forEach(function (field) {
      CONCEPTS[field].forEach(function (concept) {
        var c = g[concept]; if (!c || !c.units) return;
        var unitKey = Object.keys(c.units)[0]; var arr = c.units[unitKey] || [];
        var best = {};
        arr.forEach(function (e) {
          if (!e.form || e.form.indexOf('10-K') !== 0) return;
          if (!INSTANT[field]) {
            if (!e.start) return;
            var days = (new Date(e.end) - new Date(e.start)) / DAY; if (days < 330 || days > 400) return;
          }
          var y = e.end.slice(0, 4);
          if (!best[y] || e.filed > best[y].filed) best[y] = e;
        });
        Object.keys(best).forEach(function (y) {
          var row = years[y] || (years[y] = { year: +y, src: {} });
          if (row[field] == null) { row[field] = best[y].val; row.src[field] = 'SEC 10-K'; }
        });
      });
    });
    return { name: facts.entityName, cik: cik, years: years };
  }
  async function secProfile(cik) {
    var s = await safe(sec('data', 'submissions/CIK' + pad10(cik) + '.json'));
    return s ? { name: s.name, sic: +s.sic || 0, sicDescription: s.sicDescription || '' } : null;
  }

  // ---------- FMP statements ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  async function fmpAnnual(sym) {
    var p = { symbol: sym, period: 'annual', limit: 10 };
    var res = await Promise.all([safe(fmp('income-statement', p)), safe(fmp('balance-sheet-statement', p)), safe(fmp('cash-flow-statement', p))]);
    var years = {};
    function put(y, field, v) { v = num(v); if (v == null) return; var row = years[y] || (years[y] = { year: +y, src: {} }); if (row[field] == null) { row[field] = v; row.src[field] = 'FMP'; } }
    (res[0] || []).forEach(function (r) { var y = String(r.date || '').slice(0, 4); if (!y) return;
      put(y, 'revenue', r.revenue); put(y, 'grossProfit', r.grossProfit); put(y, 'opIncome', r.operatingIncome); put(y, 'netIncome', r.netIncome);
      put(y, 'eps', r.epsDiluted != null ? r.epsDiluted : r.epsdiluted); put(y, 'shares', r.weightedAverageShsOutDil); put(y, 'interest', r.interestExpense);
      put(y, 'ebitda', r.ebitda); put(y, 'da', r.depreciationAndAmortization); });
    (res[1] || []).forEach(function (r) { var y = String(r.date || '').slice(0, 4); if (!y) return;
      put(y, 'equity', r.totalStockholdersEquity); put(y, 'goodwill', r.goodwill); put(y, 'intangibles', r.intangibleAssets);
      put(y, 'totalDebt', r.totalDebt); put(y, 'cash', r.cashAndCashEquivalents); put(y, 'netDebt', r.netDebt);
      put(y, 'assets', r.totalAssets); put(y, 'curAssets', r.totalCurrentAssets); put(y, 'curLiab', r.totalCurrentLiabilities); put(y, 'debt', r.longTermDebt); });
    (res[2] || []).forEach(function (r) { var y = String(r.date || '').slice(0, 4); if (!y) return;
      put(y, 'ocf', r.operatingCashFlow); put(y, 'capex', r.capitalExpenditure); put(y, 'fcf', r.freeCashFlow);
      var dp = r.commonDividendsPaid != null ? r.commonDividendsPaid : r.dividendsPaid; put(y, 'divPaid', dp);
      put(y, 'sbc', r.stockBasedCompensation); put(y, 'buyback', r.commonStockRepurchased != null ? r.commonStockRepurchased : r.repurchasesOfCommonStock); });
    return Object.keys(years).length ? years : null;
  }

  function mergeYears(a, b) {
    var out = {};
    [a, b].forEach(function (src) { if (!src) return; Object.keys(src).forEach(function (y) {
      var row = out[y] || (out[y] = { year: +y, src: {} });
      Object.keys(src[y]).forEach(function (k) { if (k === 'src' || k === 'year') return; if (row[k] == null && src[y][k] != null) { row[k] = src[y][k]; row.src[k] = src[y].src[k]; } });
    }); });
    return Object.keys(out).map(function (y) { return out[y]; }).sort(function (x, y) { return y.year - x.year; }).slice(0, 11);
  }

  // ---------- Derivations ----------
  function abs(v) { return v == null ? null : Math.abs(v); }
  function fcfOf(r) { return r.fcf != null ? r.fcf : (r.ocf != null && r.capex != null ? r.ocf - Math.abs(r.capex) : null); }
  function ebitdaOf(r) { return r.ebitda != null ? r.ebitda : (r.opIncome != null && r.da != null ? r.opIncome + r.da : null); }
  function netDebtOf(r) { if (r.netDebt != null) return r.netDebt; var d = r.totalDebt != null ? r.totalDebt : (r.debt != null || r.shortDebt != null ? (r.debt || 0) + (r.shortDebt || 0) : null); return d != null && r.cash != null ? d - r.cash : null; }
  function tangEq(r) { return r.equity != null ? r.equity - (r.goodwill || 0) - (r.intangibles || 0) : null; }
  function avg(a) { a = a.filter(function (v) { return v != null && isFinite(v); }); return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function cagr(series, key, n) {
    var v0 = series[0] && series[0][key]; var k = Math.min(n, series.length - 1);
    while (k > 0 && (series[k][key] == null || series[k][key] <= 0)) k--;
    if (!k || v0 == null || v0 <= 0) return null;
    return (Math.pow(v0 / series[k][key], 1 / k) - 1) * 100;
  }
  function roicOf(r) { var ic = r.equity != null ? r.equity + (netDebtOf(r) || 0) : null; return r.opIncome != null && ic && ic > 0 ? r.opIncome * 0.79 / ic * 100 : null; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function r25(v) { return Math.round(v * 4) / 4; }

  function piotroski(a, b) {
    if (!a || !b) return null;
    var pts = 0, n = 0;
    function t(cond) { if (cond == null) return; n++; if (cond) pts++; }
    var roaA = a.netIncome != null && a.assets ? a.netIncome / a.assets : null, roaB = b.netIncome != null && b.assets ? b.netIncome / b.assets : null;
    t(a.netIncome != null ? a.netIncome > 0 : null);
    t(a.ocf != null ? a.ocf > 0 : null);
    t(roaA != null && roaB != null ? roaA > roaB : null);
    t(a.ocf != null && a.netIncome != null ? a.ocf > a.netIncome : null);
    var levA = a.debt != null && a.assets ? a.debt / a.assets : null, levB = b.debt != null && b.assets ? b.debt / b.assets : null;
    t(levA != null && levB != null ? levA <= levB : null);
    var crA = a.curAssets && a.curLiab ? a.curAssets / a.curLiab : null, crB = b.curAssets && b.curLiab ? b.curAssets / b.curLiab : null;
    t(crA != null && crB != null ? crA > crB : null);
    t(a.shares != null && b.shares != null ? a.shares <= b.shares * 1.005 : null);
    var gmA = a.grossProfit != null && a.revenue ? a.grossProfit / a.revenue : null, gmB = b.grossProfit != null && b.revenue ? b.grossProfit / b.revenue : null;
    t(gmA != null && gmB != null ? gmA > gmB : null);
    var atA = a.revenue != null && a.assets ? a.revenue / a.assets : null, atB = b.revenue != null && b.assets ? b.revenue / b.assets : null;
    t(atA != null && atB != null ? atA > atB : null);
    return n >= 7 ? Math.round(pts * 9 / n) : null;
  }

  function chooseMethod(sector, industry, sic, fcfps, payout) {
    var s = ((sector || '') + ' ' + (industry || '')).toLowerCase();
    if (/bank|insurance|capital markets/.test(s) || (sic >= 6000 && sic < 6500 && sic !== 6798 && sic !== 6141 && sic !== 6199)) return 'ptbv';
    if (/reit|real estate/.test(s) || sic === 6798) return 'asset';
    if (/utilities|telecom/.test(s) || (sic >= 4900 && sic < 5000) || sic === 4813) return 'ddm';
    if (/consumer defensive|staples/.test(s) && payout != null && payout > 0.55) return 'ddm';
    if (/energy|oil|gas|basic materials|chemical|steel|mining|auto/.test(s) || (sic >= 1000 && sic < 1500) || sic === 2911 || (sic >= 3710 && sic < 3720)) return 'ev';
    if (!(fcfps > 0)) return 'asset';
    return 'dcf';
  }
  var RATIONALE = {
    dcf: 'Operating business with positive, reasonably predictable free cash flow. A 10-year DCF on normalized free cash flow per share, net of stock-based compensation, with growth fading to a terminal rate, captures value better than trailing multiples.',
    ddm: 'Mature, high-payout business whose equity return is primarily the dividend. Discounting the dividend stream measures the cash an owner actually receives.',
    ev: 'Cyclical earnings that swing with commodity or volume cycles. Mid-cycle (5-yr average) EBITDA at a through-cycle multiple, net of debt, normalizes for the cycle.',
    ptbv: 'For banks and insurers debt is operating raw material, so EV and FCF are not meaningful. Justified P/TBV = (ROTE − g) / (COE − g) ties value to returns on tangible equity.',
    asset: 'Free cash flow is negative or the business is asset-heavy (e.g. REIT), so value is anchored to tangible book or NAV per share times a justified multiple.'
  };
  function evMultiple(sector, industry) {
    var s = ((sector || '') + ' ' + (industry || '')).toLowerCase();
    if (/auto/.test(s)) return 4; if (/energy|oil|gas/.test(s)) return 5.5; if (/materials|chemical|steel|mining/.test(s)) return 7; return 9;
  }

  async function valuation(sym, opts) {
    sym = sym.toUpperCase();
    var t10 = (opts && opts.rf) || 4.2;
    var cached = cget('val3:' + sym, 6 * 3600e3); if (cached && !(opts && opts.force)) return cached;
    var st = status();
    var fmpOn = st.fmp, proxyOn = st.proxy;
    var tasks = await Promise.all([
      fmpOn ? safe(fmp('quote', { symbol: sym })) : null,
      fmpOn ? safe(fmp('profile', { symbol: sym })) : null,
      fmpOn ? safe(fmp('ratios', { symbol: sym, period: 'annual', limit: 10 })) : null,
      fmpOn ? safe(fmpAnnual(sym)) : null,
      proxyOn ? safe(secAnnual(sym)) : null,
      proxyOn ? safe(tradier('markets/quotes', { symbols: sym })) : null
    ]);
    var quote = Array.isArray(tasks[0]) ? tasks[0][0] : null;
    var prof = Array.isArray(tasks[1]) ? tasks[1][0] : null;
    var ratios = Array.isArray(tasks[2]) ? tasks[2] : [];
    var fy = tasks[3], secd = tasks[4];
    var tq = tasks[5] && tasks[5].quotes && tasks[5].quotes.quote; if (Array.isArray(tq)) tq = tq[0];
    var series = mergeYears(fy, secd && secd.years);
    var sources = [];
    if (quote || prof || fy) sources.push('FMP');
    if (secd) sources.push('SEC EDGAR');
    if (tq) sources.push('Tradier');
    if (!sources.length) throw new Error('No data returned for ' + sym + ' from any connected source.');

    var sp = null; if (!prof && secd && secd.cik) sp = await secProfile(secd.cik);
    var price = num(quote && quote.price) != null ? quote.price : (tq && num(tq.last) != null ? tq.last : null);
    var priceSrc = num(quote && quote.price) != null ? 'FMP quote' : (price != null ? 'Tradier quote' : 'n/a');
    var beta = prof && num(prof.beta) != null ? prof.beta : null;
    var y0 = series[0] || { src: {} }, y1 = series[1];
    var shares = y0.shares, shSrc = 'Diluted · ' + ((y0.src && y0.src.shares) || 'n/a');
    for (var si = 1; !shares && si < series.length; si++) if (series[si].shares) { shares = series[si].shares; shSrc = 'Diluted · FY' + series[si].year; }
    if (!shares && prof && num(prof.marketCap) && price) { shares = prof.marketCap / price; shSrc = 'Market cap ÷ price'; }
    if (!shares && quote && num(quote.marketCap) && price) { shares = quote.marketCap / price; shSrc = 'Market cap ÷ price'; }
    var per = function (v) { return v != null && shares ? v / shares : null; };
    var fcfRows = series.filter(function (r) { return fcfOf(r) != null; }).slice(0, 3);
    var fcfAvg = avg(fcfRows.map(fcfOf)), sbcAvg = fcfRows.length ? (avg(fcfRows.map(function (r) { return r.sbc != null ? Math.abs(r.sbc) : null; })) || 0) : null;
    var fcfpsRaw = per(fcfAvg);
    var fcfps = fcfAvg != null && shares ? (fcfAvg - (sbcAvg || 0)) / shares : null;
    var fcfBuild = fcfRows.length ? { years: fcfRows.map(function (r) { return r.year; }), ocf: avg(fcfRows.map(function (r) { return r.ocf; })), capex: avg(fcfRows.map(function (r) { return r.capex != null ? Math.abs(r.capex) : null; })), fcf: fcfAvg, sbc: sbcAvg, shares: shares, sharesSrc: shSrc, perShareRaw: fcfpsRaw, perShare: fcfps } : null;
    var eps = y0.eps != null ? y0.eps : per(y0.netIncome);
    var bvps = per(y0.equity), tbvps = per(tangEq(y0));
    var dps = y0.dps != null ? y0.dps : per(abs(y0.divPaid));
    series.forEach(function (r) { if (r.dps == null && r.divPaid != null && r.shares) r.dps = Math.abs(r.divPaid) / r.shares; });
    var revG = cagr(series, 'revenue', 5), dpsG = cagr(series, 'dps', 5);
    var ebitdaMid = avg(series.slice(0, 5).map(ebitdaOf));
    var nd = netDebtOf(y0);
    var roteAvg = avg(series.slice(0, 5).map(function (r) { var te = tangEq(r); return r.netIncome != null && te > 0 ? r.netIncome / te * 100 : null; }));
    var payout = dps != null && eps > 0 ? dps / eps : null;
    var sector = (prof && prof.sector) || (sp && sp.sicDescription) || 'n/a';
    var industry = (prof && prof.industry) || '';
    var sic = sp ? sp.sic : 0;
    var method = chooseMethod(sector, industry, sic, fcfps, payout);

    var ERP = 5.0, betaAdj = beta != null ? 0.67 * beta + 0.33 : 1;
    var r = r25(clamp(t10 + betaAdj * ERP, 7, 12));
    var rSrc = 'CAPM: ' + t10 + '% rf + adj. β ' + betaAdj.toFixed(2) + (beta == null ? ' (assumed)' : '') + ' × ' + ERP.toFixed(1) + '% ERP, bounded 7–12%';
    var mkSrc = function (field) { return (y0.src && y0.src[field]) || 'n/a'; };
    var B = function (v) { return v != null ? v / 1e9 : null; };
    var inputsBy = {
      dcf: { cf: fcfps, g: revG != null ? Math.round(clamp(revG, 0, 15) * 2) / 2 : null, tg: 2.5, r: r },
      ddm: { cf: dps, g: dpsG != null ? r25(clamp(dpsG, 0, 8)) : null, tg: 2.5, r: r },
      ev: { ebitda: B(ebitdaMid), mult: evMultiple(sector, industry), nd: B(nd), sh: B(shares) },
      ptbv: { tbv: tbvps, rote: roteAvg != null ? r25(clamp(roteAvg, 0, 25)) : null, coe: r, g: 3 },
      asset: { tbv: tbvps, mult: 1.0 }
    };
    var src = {
      price: priceSrc,
      dcf: { cf: fcfBuild ? 'Auto: (FCF − SBC) 3-yr avg ÷ shares · ' + mkSrc('ocf') : 'n/a — no cash flow filings', g: revG != null ? '5-yr revenue CAGR ' + revG.toFixed(1) + '%, capped 0–15%; fades to terminal yrs 6–10' : 'n/a', tg: 'Long-run nominal GDP proxy', r: rSrc },
      ddm: { cf: 'Latest FY · ' + (y0.src.dps || y0.src.divPaid || 'n/a'), g: dpsG != null ? '5-yr DPS CAGR ' + dpsG.toFixed(1) + '%, capped 0–8%; fades yrs 6–10' : 'n/a', tg: 'Long-run nominal GDP proxy', r: rSrc },
      ev: { ebitda: '5-yr avg · ' + (y0.src.ebitda || y0.src.opIncome || 'n/a'), mult: 'Sector through-cycle assumption', nd: 'Latest FY · ' + (y0.src.netDebt || y0.src.debt || y0.src.totalDebt || 'n/a'), sh: shSrc },
      ptbv: { tbv: 'Equity − goodwill − intangibles · ' + mkSrc('equity'), rote: roteAvg != null ? '5-yr avg ' + roteAvg.toFixed(1) + '%' : 'n/a', coe: rSrc, g: 'Assumption' },
      asset: { tbv: 'Equity − goodwill − intangibles · ' + mkSrc('equity'), mult: 'Assumption' }
    };

    var pes = ratios.map(function (x) { return num(x.priceToEarningsRatio != null ? x.priceToEarningsRatio : x.priceEarningsRatio); }).filter(function (v) { return v != null && v > 0 && v < 80; });
    var peSrc = pes.length ? 'FMP' : null;
    if (!pes.length && proxyOn && series.length > 1) {
      var start = new Date(); start.setFullYear(start.getFullYear() - 11);
      var h = await safe(tradier('markets/history', { symbol: sym, interval: 'monthly', start: start.toISOString().slice(0, 10) }));
      var days = h && h.history && h.history.day; if (days && !Array.isArray(days)) days = [days];
      if (days) {
        series.forEach(function (row) {
          if (!(row.eps > 0)) return;
          var hit = days.filter(function (d) { return d.date.slice(0, 4) === String(row.year); }).pop();
          if (hit) { var pe = hit.close / row.eps; if (pe > 0 && pe < 80) pes.push(pe); }
        });
        if (pes.length) peSrc = 'Tradier prices ÷ SEC EPS';
      }
    }
    var pe10 = avg(pes);

    var roics = series.slice(0, 5).map(roicOf);
    var roicAvg = avg(roics);
    var isFin = method === 'ptbv';
    var q = {
      roic: isFin ? null : roicOf(y0),
      gm: isFin || y0.grossProfit == null || !y0.revenue ? null : y0.grossProfit / y0.revenue * 100,
      fcfm: isFin || fcfOf(y0) == null || !y0.revenue ? null : fcfOf(y0) / y0.revenue * 100,
      nde: isFin || nd == null || !ebitdaOf(y0) ? null : nd / ebitdaOf(y0),
      cov: isFin || y0.opIncome == null || !y0.interest ? null : y0.opIncome / Math.abs(y0.interest),
      sh: series.length > 5 && shares && series[5].shares ? (shares / series[5].shares - 1) * 100 : null,
      rev: revG,
      f: piotroski(y0, y1)
    };
    var moat = isFin ? (roteAvg == null ? 'n/a' : roteAvg >= 15 ? 'Wide' : roteAvg >= 10 ? 'Narrow' : 'None') : (roicAvg == null ? 'n/a' : roicAvg >= 15 ? 'Wide' : roicAvg >= 9 ? 'Narrow' : 'None');

    var rec = {
      symbol: sym, live: true,
      name: (prof && prof.companyName) || (quote && quote.name) || (secd && secd.name) || (sp && sp.name) || sym,
      sector: industry ? sector + ' · ' + industry : sector,
      moat: moat, price: price, beta: beta,
      eps: eps, bvps: bvps, fcfps: isFin ? null : fcfps, pe10: pe10, peYears: pes.length, peSrc: peSrc,
      method: method, inputsBy: inputsBy, inputs: inputsBy[method], src: src, rationale: RATIONALE[method], rationales: RATIONALE,
      q: q, years: series.length, sources: sources, asOf: new Date().toISOString(),
      industry: industry, description: (prof && prof.description) || '', website: (prof && prof.website) || '', ceo: (prof && prof.ceo) || '',
      employees: prof && prof.fullTimeEmployees ? +prof.fullTimeEmployees : null,
      hq: prof && prof.city ? prof.city + (prof.state ? ', ' + prof.state : '') : '',
      exchange: (prof && (prof.exchange || prof.exchangeShortName)) || '',
      marketCapB: prof && num(prof.marketCap) != null ? prof.marketCap / 1e9 : (price != null && shares ? price * shares / 1e9 : null),
      chg: quote && num(quote.changePercentage) != null ? quote.changePercentage : (tq && num(tq.change_percentage) != null ? tq.change_percentage : null),
      hi52: tq && num(tq.week_52_high) != null ? tq.week_52_high : (quote ? num(quote.yearHigh) : null),
      lo52: tq && num(tq.week_52_low) != null ? tq.week_52_low : (quote ? num(quote.yearLow) : null),
      dps: dps, fcfBuild: fcfBuild, shares: shares, fcfpsRaw: fcfpsRaw,
      hist: series.filter(function (r) { return r.revenue != null; }).slice(0, 5).reverse().map(function (r) {
        return { grossProfit: r.grossProfit != null ? r.grossProfit : null, ebitda: ebitdaOf(r), eps: r.eps != null ? r.eps : null, ocf: r.ocf != null ? r.ocf : null, capex: r.capex != null ? Math.abs(r.capex) : null, sbc: r.sbc != null ? Math.abs(r.sbc) : null, divPaid: r.divPaid != null ? Math.abs(r.divPaid) : null, buyback: r.buyback != null ? Math.abs(r.buyback) : null, cash: r.cash != null ? r.cash : null, debt: r.totalDebt != null ? r.totalDebt : (r.debt != null || r.shortDebt != null ? (r.debt || 0) + (r.shortDebt || 0) : null), netDebt: netDebtOf(r), equity: r.equity != null ? r.equity : null, curAssets: r.curAssets != null ? r.curAssets : null, curLiab: r.curLiab != null ? r.curLiab : null, shares: r.shares != null ? r.shares : null, year: r.year, revenue: r.revenue, netIncome: r.netIncome != null ? r.netIncome : null, opIncome: r.opIncome != null ? r.opIncome : null, fcf: fcfOf(r), dps: r.dps != null ? r.dps : null };
      })
    };
    cset('val3:' + sym, rec);
    return rec;
  }

  // ---------- Screener (Tradier chains) ----------
  function arr(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function dteOf(d) { return Math.round((new Date(d + 'T20:00:00Z') - Date.now()) / DAY); }
  function recordIv(sym, iv) {
    var k = 'ivh:' + sym, h = cget(k, 400 * DAY) || {}; h[new Date().toISOString().slice(0, 10)] = iv;
    var ks = Object.keys(h).sort(); while (ks.length > 260) delete h[ks.shift()];
    cset(k, h);
    var vals = Object.keys(h).map(function (d) { return h[d]; });
    if (vals.length < 20) return { rank: null, n: vals.length };
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return { rank: hi > lo ? Math.round((iv - lo) / (hi - lo) * 100) : 50, n: vals.length };
  }
  async function profileCached(sym) {
    var c = cget('prof:' + sym, 7 * DAY); if (c !== undefined) return c;
    if (!status().fmp) return null;
    var p = await safe(fmp('profile', { symbol: sym })); p = Array.isArray(p) ? p[0] : null;
    var v = p ? { marketCapB: num(p.marketCap) != null ? p.marketCap / 1e9 : null, beta: num(p.beta), averageVolume: num(p.averageVolume), sector: p.sector || null, name: p.companyName || null, lastDiv: num(p.lastDividend != null ? p.lastDividend : p.lastDiv) } : null;
    if (v) cset('prof:' + sym, v); return v;
  }
  async function earningsMap() {
    var c = cget('earncal', 12 * 3600e3); if (c) return c;
    if (!status().fmp) return {};
    var from = new Date(), to = new Date(Date.now() + 90 * DAY);
    var r = await safe(fmp('earnings-calendar', { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }));
    if (!Array.isArray(r)) return {};
    var m = {}; arr(r).forEach(function (e) { if (e.symbol && e.date && (!m[e.symbol] || e.date < m[e.symbol])) m[e.symbol] = e.date; });
    cset('earncal', m); return m;
  }

  async function screen(symbols, f, onProgress) {
    if (!status().proxy) throw new Error('Tradier proxy URL not configured');
    var quotes = {};
    for (var i = 0; i < symbols.length; i += 100) {
      var qr = await tradier('markets/quotes', { symbols: symbols.slice(i, i + 100).join(',') });
      arr(qr.quotes && qr.quotes.quote).forEach(function (q) { quotes[q.symbol] = q; });
    }
    var earn = await earningsMap();
    // Contract targeting: use the band midpoint when narrowed; when wide open, fall back to the classic wheel target (~37 DTE, 0.25 delta).
    var mid = f.dteMax - f.dteMin <= 120 ? (f.dteMin + f.dteMax) / 2 : clamp(37, f.dteMin, f.dteMax);
    var dmid = f.deltaMax - f.deltaMin <= 0.5 ? (f.deltaMin + f.deltaMax) / 2 : clamp(0.25, f.deltaMin, f.deltaMax);
    var out = [], done = 0, errors = 0, queue = symbols.slice();
    async function worker() {
      while (queue.length) {
        var sym = queue.shift();
        try {
          var q = quotes[sym]; if (!q || q.last == null) throw new Error('no quote');
          var ex = await tradier('markets/options/expirations', { symbol: sym });
          var dates = arr(ex.expirations && ex.expirations.date); if (!dates.length) throw new Error('no expirations');
          var inBand = dates.filter(function (d) { var x = dteOf(d); return x >= f.dteMin && x <= f.dteMax; });
          var pick = (inBand.length ? inBand : dates).slice().sort(function (a, b) { return Math.abs(dteOf(a) - mid) - Math.abs(dteOf(b) - mid); })[0];
          var ch = await tradier('markets/options/chains', { symbol: sym, expiration: pick, greeks: 'true' });
          var puts = arr(ch.options && ch.options.option).filter(function (o) { return o.option_type === 'put' && o.greeks; }).sort(function (a, b) { return a.strike - b.strike; });
          if (!puts.length) throw new Error('no puts');
          var band = puts.filter(function (o) { var d = Math.abs(o.greeks.delta); return d >= f.deltaMin && d <= f.deltaMax; });
          var tgt = (band.length ? band : puts).slice().sort(function (a, b) { return Math.abs(Math.abs(a.greeks.delta) - dmid) - Math.abs(Math.abs(b.greeks.delta) - dmid); })[0];
          var idx = puts.indexOf(tgt);
          var atm = puts.slice().sort(function (a, b) { return Math.abs(a.strike - q.last) - Math.abs(b.strike - q.last); })[0];
          var iv30 = atm && atm.greeks.mid_iv ? atm.greeks.mid_iv * 100 : null;
          var ivr = iv30 != null ? recordIv(sym, iv30) : { rank: null, n: 0 };
          var prof = await profileCached(sym);
          var ed = earn[sym];
          var chain = puts.slice(Math.max(0, idx - 2), idx + 3).map(function (o) {
            return { strike: o.strike, dte: dteOf(pick), delta: Math.abs(o.greeks.delta), bid: o.bid || 0, ask: o.ask || 0, oi: o.open_interest || 0, iv: o.greeks.mid_iv ? o.greeks.mid_iv * 100 : null, isTarget: o === tgt };
          });
          out.push({
            symbol: sym, live: true, price: q.last,
            marketCapB: prof ? prof.marketCapB : null, beta: prof ? prof.beta : null,
            daysToEarnings: ed ? dteOf(ed) : null,
            avgVolumeM: q.average_volume ? q.average_volume / 1e6 : (prof && prof.averageVolume ? prof.averageVolume / 1e6 : null),
            ivRank: ivr.rank, ivHistoryDays: ivr.n, iv30: iv30,
            strike: tgt.strike, expiryLabel: new Date(pick + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
            dte: dteOf(pick), delta: Math.abs(tgt.greeks.delta), bid: tgt.bid || 0, ask: tgt.ask || 0, oi: tgt.open_interest || 0, chain: chain
          });
        } catch (e) { errors++; }
        done++; if (onProgress) onProgress(done, symbols.length, errors);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return { rows: out, errors: errors, asOf: new Date().toISOString() };
  }

  // ---------- Stock screener ----------
  async function screenerProfiles() {
    var c = cget('scrprof', DAY); if (c) return c;
    if (!status().fmp) return null;
    var r = await safe(fmp('company-screener', { marketCapMoreThan: 1000000000, isEtf: 'false', isFund: 'false', isActivelyTrading: 'true', country: 'US', limit: 5000 }));
    if (!Array.isArray(r) || !r.length) return null;
    var m = {};
    r.forEach(function (x) { if (x.symbol) m[x.symbol] = [x.companyName || '', x.sector || '', num(x.marketCap), num(x.beta), num(x.lastAnnualDividend), num(x.price), num(x.volume)]; });
    cset('scrprof', m); return m;
  }
  async function quotes(symbols) {
    var out = {};
    if (!status().proxy) return out;
    for (var i = 0; i < symbols.length; i += 150) {
      var qr = await safe(tradier('markets/quotes', { symbols: symbols.slice(i, i + 150).join(',') }));
      arr(qr && qr.quotes && qr.quotes.quote).forEach(function (q) {
        if (q && q.symbol) out[q.symbol] = { name: q.description, price: num(q.last) != null ? q.last : num(q.prevclose), chg: num(q.change_percentage), vol: num(q.volume), avgVol: num(q.average_volume), hi52: num(q.week_52_high), lo52: num(q.week_52_low) };
      });
    }
    return out;
  }
  async function stockList(key, watchlist) {
    var u = await universe();
    var prof = await screenerProfiles();
    var syms;
    if (key === 'watchlist') syms = (watchlist || []).slice();
    else if (key === 'all') syms = prof ? Object.keys(prof) : Object.keys(u.map);
    else { var tag = key === 'ndx' ? NQ : key === 'dji' ? DJ : SP; syms = Object.keys(u.map).filter(function (k) { return u.map[k].indices.indexOf(tag) !== -1; }); }
    var q = await quotes(syms);
    var missing = syms.filter(function (s) { return !(prof && prof[s]); }).slice(0, 40);
    var extra = {};
    for (var i = 0; i < missing.length; i++) { var p0 = await profileCached(missing[i]); if (p0) extra[missing[i]] = p0; }
    var earn = await earningsMap();
    var rows = syms.map(function (s) {
      var p = prof && prof[s], e = extra[s], qq = q[s] || {}, um = u.map[s] || {};
      var price = qq.price != null ? qq.price : (p ? p[5] : null);
      var div = p ? p[4] : (e ? e.lastDiv : null);
      return {
        symbol: s, name: qq.name || (p && p[0]) || um.name || (e && e.name) || s,
        sector: (p && p[1]) || um.sector || (e && e.sector) || null, indices: um.indices || [],
        price: price, chg: qq.chg != null ? qq.chg : null,
        marketCapB: p && p[2] != null ? p[2] / 1e9 : (e ? e.marketCapB : null),
        beta: p ? p[3] : (e ? e.beta : null),
        divYield: div != null && price ? div / price * 100 : null,
        avgVolumeM: qq.avgVol != null ? qq.avgVol / 1e6 : (e && e.averageVolume ? e.averageVolume / 1e6 : (p && p[6] != null ? p[6] / 1e6 : null)),
        volumeM: qq.vol != null ? qq.vol / 1e6 : null, hi52: qq.hi52 != null ? qq.hi52 : null, lo52: qq.lo52 != null ? qq.lo52 : null,
        earnDays: earn[s] ? dteOf(earn[s]) : null, earnDate: earn[s] || null
      };
    }).filter(function (r) { return r.price != null || r.marketCapB != null; });
    return { rows: rows, constituentsLive: u.live, profilesLive: !!prof, quotesLive: Object.keys(q).length > 0, asOf: new Date().toISOString() };
  }
  async function optionMetrics(sym, price) {
    var c = cget('opt:' + sym, 15 * 60e3); if (c) return c;
    var ex = await tradier('markets/options/expirations', { symbol: sym });
    var dates = arr(ex.expirations && ex.expirations.date);
    if (!dates.length) return null;
    var pick = dates.filter(function (d) { return dteOf(d) >= 7; }).sort(function (a, b) { return Math.abs(dteOf(a) - 30) - Math.abs(dteOf(b) - 30); })[0] || dates[0];
    var ch = await tradier('markets/options/chains', { symbol: sym, expiration: pick, greeks: 'true' });
    var opts = arr(ch.options && ch.options.option);
    if (!opts.length) return null;
    var by = {}, vol = 0, oi = 0;
    opts.forEach(function (o) {
      vol += o.volume || 0; oi += o.open_interest || 0;
      (by[o.strike] || (by[o.strike] = { strike: o.strike }))[o.option_type] = { bid: o.bid || 0, ask: o.ask || 0, iv: o.greeks && o.greeks.mid_iv ? o.greeks.mid_iv * 100 : null, oi: o.open_interest || 0, vol: o.volume || 0, delta: o.greeks ? o.greeks.delta : null };
    });
    var strikes = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
    var ref = price || strikes[Math.floor(strikes.length / 2)];
    var ai = 0; strikes.forEach(function (k, i) { if (Math.abs(k - ref) < Math.abs(strikes[ai] - ref)) ai = i; });
    var atm = by[strikes[ai]];
    var ivs = [atm.put && atm.put.iv, atm.call && atm.call.iv].filter(function (v) { return v != null; });
    var iv30 = ivs.length ? ivs.reduce(function (s, v) { return s + v; }, 0) / ivs.length : null;
    var p = atm.put || atm.call, mid = p ? (p.bid + p.ask) / 2 : 0;
    var ivr = iv30 != null ? recordIv(sym, iv30) : { rank: null, n: 0 };
    var res = {
      expiry: pick, dte: dteOf(pick), iv30: iv30, ivRank: ivr.rank, ivDays: ivr.n, optVol: vol, optOI: oi,
      atmStrike: strikes[ai], atmSpread: p ? p.ask - p.bid : null, atmSpreadPct: p && mid > 0 ? (p.ask - p.bid) / mid * 100 : null,
      chain: strikes.slice(Math.max(0, ai - 4), ai + 5).map(function (k) { var r = by[k]; return { strike: k, atm: k === strikes[ai], call: r.call || null, put: r.put || null }; })
    };
    cset('opt:' + sym, res); return res;
  }

  // ---------- Price history ----------
  var RANGES = { '1M': [31, 'daily'], '6M': [183, 'daily'], '1Y': [366, 'daily'], '5Y': [1827, 'weekly'], '10Y': [3653, 'weekly'] };
  async function priceHistory(sym, range) {
    sym = sym.toUpperCase(); range = RANGES[range] ? range : '1Y';
    var key = 'ph:' + sym + ':' + range, c = cget(key, 3600e3); if (c) return c;
    var R = RANGES[range], start = new Date(Date.now() - R[0] * DAY).toISOString().slice(0, 10), pts = null;
    if (status().proxy) {
      var h = await safe(tradier('markets/history', { symbol: sym, interval: R[1], start: start }));
      var days = arr(h && h.history && h.history.day);
      if (days.length) pts = days.map(function (d) { return { d: d.date, c: num(d.close) }; }).filter(function (p) { return p.c != null; });
    }
    if ((!pts || !pts.length) && status().fmp) {
      var f = await safe(fmp('historical-price-eod/light', { symbol: sym, from: start }));
      if (Array.isArray(f) && f.length) {
        pts = f.map(function (x) { return { d: x.date, c: num(x.price != null ? x.price : x.close) }; }).filter(function (p) { return p.c != null; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        if (R[1] === 'weekly') pts = pts.filter(function (p, i) { return i % 5 === 0 || i === pts.length - 1; });
      }
    }
    if (pts && pts.length) cset(key, pts);
    return pts || [];
  }

  // ---------- Dividends ----------
  async function dividendProfile(sym) {
    sym = sym.toUpperCase();
    var key = 'div3:' + sym, c = cget(key, 6 * 3600e3); if (c) return c;
    var st = status();
    var out = { symbol: sym, name: sym, price: null, annualDiv: null, freq: 4, divGrowth5: null, priceGrowth5: null, history: [], sources: [], divSrc: '' };
    var q = st.proxy ? await safe(tradier('markets/quotes', { symbols: sym })) : null;
    var tq = q && q.quotes && q.quotes.quote; if (Array.isArray(tq)) tq = tq[0];
    if (tq) { out.price = num(tq.last) != null ? tq.last : num(tq.prevclose); out.name = tq.description || sym; out.sources.push('Tradier'); }
    var divs = st.fmp ? await safe(fmp('dividends', { symbol: sym })) : null;
    if (Array.isArray(divs) && divs.length) {
      out.sources.push('FMP');
      var now = Date.now(), amt = function (d) { return num(d.adjDividend != null ? d.adjDividend : d.dividend) || 0; };
      var ttm = divs.filter(function (d) { return now - new Date(d.date) <= 365 * DAY; });
      var tot = ttm.reduce(function (s, d) { return s + amt(d); }, 0);
      if (tot > 0) { out.annualDiv = tot; out.divSrc = 'Trailing 12 months · FMP'; out.freq = [12, 4, 2, 1].reduce(function (b, f) { return Math.abs(f - ttm.length) < Math.abs(b - ttm.length) ? f : b; }, 4); }
      out.months = ttm.map(function (d) { return new Date((d.paymentDate || d.date) + 'T12:00:00Z').getUTCMonth(); }).filter(function (m) { return m >= 0 && m < 12; });
      var today = new Date().toISOString().slice(0, 10);
      var sortedD = divs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      out.recent = sortedD.slice(0, 14).map(function (d) { return { date: d.date, pay: d.paymentDate || null, decl: d.declarationDate || null, amount: amt(d) }; });
      var futD = sortedD.filter(function (d) { return d.date >= today; });
      if (futD.length) { var nx = futD[futD.length - 1]; out.next = { exDate: nx.date, payDate: nx.paymentDate || null, amount: amt(nx), declared: true }; }
      var byY = {}; divs.forEach(function (d) { var y = +String(d.date).slice(0, 4); byY[y] = (byY[y] || 0) + amt(d); });
      var cy = new Date().getFullYear(); for (var y = cy - 11; y < cy; y++) if (byY[y]) out.history.push({ year: y, dps: byY[y] });
    }
    if (out.annualDiv == null || !out.history.length) {
      var rec = await safe(valuation(sym));
      if (rec) {
        if (out.price == null) out.price = rec.price;
        if (out.name === sym && rec.name) out.name = rec.name;
        if (!out.history.length && rec.hist) out.history = rec.hist.filter(function (h) { return h.dps > 0; }).map(function (h) { return { year: h.year, dps: h.dps }; });
        if (out.annualDiv == null && out.history.length) { out.annualDiv = out.history[out.history.length - 1].dps; out.divSrc = 'FY' + out.history[out.history.length - 1].year + ' · SEC 10-K'; }
        if (rec.sources.indexOf('SEC EDGAR') !== -1 && out.sources.indexOf('SEC EDGAR') === -1) out.sources.push('SEC EDGAR');
      }
    }
    var hh = out.history;
    if (hh.length >= 3) { var a = hh[0], b = hh[hh.length - 1]; if (a.dps > 0 && b.dps > 0 && b.year > a.year) out.divGrowth5 = (Math.pow(b.dps / a.dps, 1 / (b.year - a.year)) - 1) * 100; }
    var ph = await safe(priceHistory(sym, '5Y'));
    if (ph && ph.length > 20) {
      var p0 = ph[0].c, p1 = ph[ph.length - 1].c, yrs = (new Date(ph[ph.length - 1].d) - new Date(ph[0].d)) / (365.25 * DAY);
      if (p0 > 0 && yrs > 1) out.priceGrowth5 = (Math.pow(p1 / p0, 1 / yrs) - 1) * 100;
    }
    if (!out.next && out.recent && out.recent.length) {
      var tdy = new Date().toISOString().slice(0, 10), le = out.recent.find(function (x) { return x.date < tdy; });
      if (le) {
        var stp = 365.25 / (out.freq || 4) * DAY, tt = new Date(le.date + 'T12:00:00Z').getTime();
        var lag = le.pay ? new Date(le.pay + 'T12:00:00Z').getTime() - tt : 14 * DAY;
        while (tt < Date.now() - DAY) tt += stp;
        out.next = { exDate: new Date(tt).toISOString().slice(0, 10), payDate: new Date(tt + lag).toISOString().slice(0, 10), amount: le.amount, declared: false };
      }
    }
    var pcp = await safe(profileCached(sym)); if (pcp && pcp.sector) out.sector = pcp.sector;
    if (out.price == null) throw new Error('No price data for ' + sym);
    out.asOf = new Date().toISOString();
    cset(key, out);
    return out;
  }

  // ---------- Intrinsic value ----------
  var METHOD_NAMES = { dcf: 'Discounted Cash Flow (10-yr, fading growth)', ddm: 'Dividend Discount Model (10-yr, fading growth)', ev: 'Normalized EV / EBITDA (mid-cycle)', ptbv: 'Justified Price / Tangible Book', asset: 'Asset-Based (Tangible Book / NAV)' };
  var FIELD_LABELS = {
    dcf: [['cf', 'FCF / share (ex-SBC, 3-yr avg)', '$'], ['g', '5-yr growth', '%'], ['tg', 'Terminal growth', '%'], ['r', 'Discount rate', '%']],
    ddm: [['cf', 'Dividend / share', '$'], ['g', '5-yr dividend growth', '%'], ['tg', 'Terminal growth', '%'], ['r', 'Required return', '%']],
    ev: [['ebitda', 'Mid-cycle EBITDA', '$B'], ['mult', 'EV / EBITDA multiple', 'x'], ['nd', 'Net debt', '$B'], ['sh', 'Diluted shares', 'B']],
    ptbv: [['tbv', 'Tangible book / share', '$'], ['rote', 'Sustainable ROTE', '%'], ['coe', 'Cost of equity', '%'], ['g', 'Long-run growth', '%']],
    asset: [['tbv', 'Tangible book / share', '$'], ['mult', 'Justified P / TBV', 'x']]
  };
  function twoStage(cf, g, tg, r) {
    g /= 100; tg /= 100; r /= 100; if (r <= tg) return NaN;
    var pv = 0, c = cf;
    for (var i = 1; i <= 10; i++) { var gi = i <= 5 ? g : g - (g - tg) * (i - 5) / 5; c *= 1 + gi; pv += c / Math.pow(1 + r, i); }
    return pv + (c * (1 + tg) / (r - tg)) / Math.pow(1 + r, 10);
  }
  function intrinsic(rec, method) {
    method = method || rec.method;
    var p = (rec.inputsBy && rec.inputsBy[method]) || rec.inputs || {}, f = FIELD_LABELS[method] || [];
    var all = f.every(function (x) { return num(p[x[0]]) != null; }), v = NaN;
    if (all) {
      if (method === 'dcf' || method === 'ddm') v = twoStage(p.cf, p.g, p.tg, p.r);
      else if (method === 'ev') v = p.sh ? (p.ebitda * p.mult - p.nd) / p.sh : NaN;
      else if (method === 'ptbv') v = p.coe > p.g ? p.tbv * (p.rote - p.g) / (p.coe - p.g) : NaN;
      else v = p.tbv * p.mult;
    }
    return { method: method, name: METHOD_NAMES[method], rationale: RATIONALE[method], value: isFinite(v) ? v : null, inputs: f.map(function (x) { return { key: x[0], label: x[1], unit: x[2], value: num(p[x[0]]) }; }) };
  }

  // ---------- Company bio (Wikipedia fallback when FMP has no description) ----------
  async function companyBio(name) {
    if (!name) return null;
    var key = 'bio:' + name, c = cget(key, 30 * DAY); if (c !== undefined) return c;
    var clean = String(name).replace(/[,.]/g, ' ').replace(/\s+(inc|corp|corporation|co|company|ltd|plc|holdings?|group|class [a-z]|common stock)\b.*$/i, '').trim();
    try {
      var sr = await getJson('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=' + encodeURIComponent(clean + ' company'));
      var hit = sr.query && sr.query.search && sr.query.search[0];
      var v = null;
      if (hit) {
        var sm = await getJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(hit.title.replace(/ /g, '_')));
        if (sm && sm.extract) v = { text: sm.extract, source: 'Wikipedia', url: (sm.content_urls && sm.content_urls.desktop && sm.content_urls.desktop.page) || '' };
      }
      cset(key, v); return v;
    } catch (e) { return null; }
  }

  async function rsi(sym, period) {
    sym = sym.toUpperCase(); period = period || 14;
    var key = 'rsi:' + sym, c = cget(key, 3600e3); if (c !== undefined) return c;
    var pts = await safe(priceHistory(sym, '6M'));
    var v = null;
    if (pts && pts.length > period + 1) {
      var g = 0, l = 0;
      for (var i = 1; i <= period; i++) { var d = pts[i].c - pts[i - 1].c; if (d > 0) g += d; else l -= d; }
      g /= period; l /= period;
      for (var j = period + 1; j < pts.length; j++) { var e = pts[j].c - pts[j - 1].c; g = (g * (period - 1) + Math.max(e, 0)) / period; l = (l * (period - 1) + Math.max(-e, 0)) / period; }
      v = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      v = Math.round(v * 10) / 10;
    }
    if (v != null) cset(key, v);
    return v;
  }

  var FORM_DESC = { '8-K': 'Material event filing (8-K)', '10-Q': 'Quarterly report (10-Q)', '10-K': 'Annual report (10-K)', 'DEF 14A': 'Proxy statement', '6-K': 'Foreign issuer report (6-K)', '20-F': 'Annual report (20-F)' };
  var TOP_SRC = /reuters|bloomberg|cnbc|wall street journal|wsj|barron|marketwatch|financial times|ft\.com|yahoo finance|associated press|ap news|forbes|business insider|fortune|the motley fool|morningstar|investor's business daily|seeking alpha|axios|new york times|economist|kiplinger|zacks/i;
  async function headlines(sym, name) {
    var out = [];
    if (status().fmp) {
      var r = await safe(fmp('news/stock', { symbols: sym, limit: 15 }));
      if (Array.isArray(r) && r.length) out = r.map(function (x) { return { title: x.title, url: x.url, site: x.site || x.publisher || '', date: String(x.publishedDate || '').slice(0, 10) }; });
    }
    if (!out.length && status().proxy && typeof DOMParser !== 'undefined') {
      try {
        var q = sym + (name ? ' OR "' + String(name).replace(/[,.]|\b(inc|corp|corporation|co|company|ltd|plc|holdings?)\b/gi, '').replace(/\s+/g, ' ').trim() + '"' : '') + ' stock';
        var res = await fetch(getSettings().proxyUrl + '/news?q=' + encodeURIComponent(q.replace(/"/g, '').slice(0, 40)));
        if (res.ok) {
          var xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
          Array.prototype.slice.call(xml.querySelectorAll('item')).forEach(function (it) {
            var t = (it.querySelector('title') || {}).textContent || '', src = (it.querySelector('source') || {}).textContent || '';
            if (src && t.slice(-(src.length + 3)) === ' - ' + src) t = t.slice(0, -(src.length + 3));
            var pd = (it.querySelector('pubDate') || {}).textContent || '';
            out.push({ title: t, url: (it.querySelector('link') || {}).textContent || '', site: src, date: pd ? new Date(pd).toISOString().slice(0, 10) : '', top: TOP_SRC.test(src) });
          });
          out.sort(function (x, y) { return (y.top ? 1 : 0) - (x.top ? 1 : 0) || (y.date > x.date ? 1 : -1); });
          var tops = out.filter(function (x) { return x.top; });
          out = (tops.length >= 5 ? tops : out).sort(function (x, y) { return y.date > x.date ? 1 : -1; });
        }
      } catch (e) {}
    }
    return out.filter(function (x) { return x.title && x.url; }).slice(0, 10);
  }
  async function filings(sym) {
    var items = [];
    if (!status().proxy) return items;
    var cik = await safe(secCik(sym));
    if (!cik) return items;
    var sub = await safe(sec('data', 'submissions/CIK' + pad10(cik) + '.json'));
    var rc = sub && sub.filings && sub.filings.recent;
    if (rc && rc.form) {
      for (var i = 0; i < rc.form.length && items.length < 10; i++) {
        var f = rc.form[i]; if (!FORM_DESC[f]) continue;
        var dsc = rc.primaryDocDescription && rc.primaryDocDescription[i];
        items.push({ title: FORM_DESC[f] + (dsc && dsc.toUpperCase() !== f ? ' — ' + dsc : ''), url: 'https://www.sec.gov/Archives/edgar/data/' + cik + '/' + String(rc.accessionNumber[i]).replace(/-/g, '') + '/' + rc.primaryDocument[i], site: f, date: rc.filingDate[i] });
      }
    }
    return items;
  }
  async function news(sym, name) {
    sym = sym.toUpperCase();
    var key = 'news2:' + sym, c = cget(key, 30 * 60e3); if (c) return c;
    var res = await Promise.all([safe(headlines(sym, name)), safe(filings(sym))]);
    var out = { headlines: res[0] || [], filings: res[1] || [] };
    if (out.headlines.length || out.filings.length) cset(key, out);
    return out;
  }

  async function peers(sym, sector) {
    sym = sym.toUpperCase();
    var key = 'peers:' + sym, c = cget(key, 7 * DAY); if (c) return c;
    var list = [];
    if (status().fmp) {
      var r = await safe(fmp('stock-peers', { symbol: sym }));
      if (Array.isArray(r) && r.length) list = r[0] && r[0].peersList ? r[0].peersList : r.map(function (x) { return x.symbol; });
    }
    if (!list.length && sector) {
      var u = await universe(), s0 = String(sector).split(' · ')[0];
      list = Object.keys(u.map).filter(function (k) { return k !== sym && u.map[k].sector && u.map[k].sector === s0; });
    }
    list = list.filter(function (x) { return x && x !== sym; }).slice(0, 8);
    if (list.length) cset(key, list);
    return list;
  }

  window.LiveData = {
    peers: peers, news: news,
    rsi: rsi, priceHistory: priceHistory, dividendProfile: dividendProfile, intrinsic: intrinsic, companyBio: companyBio, methodNames: METHOD_NAMES,
    stockList: stockList, optionMetrics: optionMetrics,
    getSettings: getSettings, saveSettings: saveSettings, status: status, testConnection: testConnection, clearCache: clearCache,
    universe: universe, fallbackUniverse: fallbackUniverse, valuation: valuation, screen: screen, rationale: RATIONALE
  };
})();

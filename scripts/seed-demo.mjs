/*
 * Loads a realistic set of DEMO data into the Finance Operating System so the
 * dashboards have something to show before real ETL feeds are connected.
 *
 * Safe to re-run: it clears and rebuilds only the Finance OS demo tables. It
 * never touches your login accounts (users) or the month-end close tracker.
 *
 *   DATABASE_URL="postgres://..." npm run seed-demo
 *
 * Every figure here is invented for illustration. Replace with real feeds
 * (Xero, POS, warehouse, HSBC, Excel models) when you are ready.
 */
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run:  DATABASE_URL=... npm run seed-demo");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

// Small deterministic pseudo-random generator so re-runs produce the same
// demo numbers (nicer for screenshots and reproducible bug reports).
let _seed = 20260717;
function rnd() {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
function jitter(base, pct) {
  return Math.round(base * (1 + (rnd() * 2 - 1) * pct));
}
const dateKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const monthName = (d) => d.toLocaleString("en-GB", { month: "long" });
const dayName = (d) => d.toLocaleString("en-GB", { weekday: "long" });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- Clear demo data (facts first, then dimensions) ------------------
    await client.query(`
      TRUNCATE
        finance.fact_financials, finance.fact_management_account_commentary,
        finance.fact_cashflow, finance.fact_bank_position,
        finance.fact_fixed_asset_monthly, finance.dim_fixed_asset,
        commercial.fact_store_sales, commercial.fact_store_kpi,
        commercial.fact_franchise, commercial.fact_franchise_helpdesk,
        operations.fact_inventory, operations.fact_inventory_movement,
        intelligence.fact_kpi_result, intelligence.ai_insight, intelligence.action_register,
        core.dim_date, core.dim_entity, core.dim_store, core.dim_account,
        core.dim_department, core.dim_product, core.dim_scenario
      RESTART IDENTITY CASCADE
    `);

    // --- Calendar: month-end dates for FY2025 and FY2026 -----------------
    // (Month grain is enough for these dashboards.)
    const dates = [];
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(y, m + 1, 0)); // last day of month
        dates.push(d);
      }
    }
    for (const d of dates) {
      const fy = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; // Apr-start fiscal year
      const fMonth = ((d.getUTCMonth() - 3 + 12) % 12) + 1;
      await client.query(
        `INSERT INTO core.dim_date
          (date_key, calendar_date, day_name, week_start_date, month_number, month_name,
           quarter_number, calendar_year, fiscal_month, fiscal_quarter, fiscal_year,
           is_month_end, is_weekend)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)`,
        [
          dateKey(d), d.toISOString().slice(0, 10), dayName(d),
          new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10),
          d.getUTCMonth() + 1, monthName(d),
          Math.floor(d.getUTCMonth() / 3) + 1, d.getUTCFullYear(),
          fMonth, Math.floor((fMonth - 1) / 3) + 1, fy,
          [0, 6].includes(d.getUTCDay()),
        ]
      );
    }

    // --- Entities --------------------------------------------------------
    const { rows: [grp] } = await client.query(
      `INSERT INTO core.dim_entity (entity_code, entity_name, entity_type, currency_code)
       VALUES ('MUK','Miniso UK','GROUP','GBP') RETURNING entity_id`
    );
    const { rows: [retail] } = await client.query(
      `INSERT INTO core.dim_entity (entity_code, entity_name, entity_type, parent_entity_id)
       VALUES ('MUK-RET','Miniso UK Retail','OPERATING',$1) RETURNING entity_id`,
      [grp.entity_id]
    );
    await client.query(
      `INSERT INTO core.dim_entity (entity_code, entity_name, entity_type, parent_entity_id)
       VALUES ('MUK-FRAN','Miniso UK Franchise','OPERATING',$1)`,
      [grp.entity_id]
    );

    // --- Stores ----------------------------------------------------------
    const stores = [
      ["S001", "Oxford Street", "COMPANY", "London", "A. Patel", 3200],
      ["S002", "Westfield Stratford", "COMPANY", "London", "A. Patel", 2800],
      ["S003", "Manchester Arndale", "COMPANY", "North", "J. Owusu", 2600],
      ["S004", "Birmingham Bullring", "COMPANY", "Midlands", "J. Owusu", 2400],
      ["S005", "Glasgow Buchanan", "COMPANY", "Scotland", "R. Khan", 2200],
      ["F101", "Cardiff (Franchise)", "FRANCHISE", "Wales", "Franchisee", 1800],
      ["F102", "Leeds (Franchise)", "FRANCHISE", "North", "Franchisee", 1900],
      ["E900", "Online Store", "ECOMMERCE", "National", "Digital Team", 0],
    ];
    const storeIds = {};
    for (const [code, name, own, region, mgr, sqft] of stores) {
      const { rows } = await client.query(
        `INSERT INTO core.dim_store
          (store_code, store_name, entity_id, ownership_type, region, area_manager, selling_sqft, total_sqft, store_format)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING store_id`,
        [code, name, own === "FRANCHISE" ? retail.entity_id : retail.entity_id, own, region, mgr, sqft, sqft * 1.3, own === "ECOMMERCE" ? "Online" : "High Street"]
      );
      storeIds[code] = rows[0].store_id;
    }

    // --- Chart of accounts (P&L) ----------------------------------------
    const accounts = [
      ["4000", "Revenue", "P&L", "Revenue", 1, "VARIABLE", 10],
      ["5000", "Cost of Goods Sold", "P&L", "Cost of Sales", -1, "VARIABLE", 20],
      ["6000", "Store Labour", "P&L", "Operating Costs", -1, "SEMI_VARIABLE", 30],
      ["6100", "Occupancy & Rent", "P&L", "Operating Costs", -1, "FIXED", 40],
      ["6200", "Other Store Costs", "P&L", "Operating Costs", -1, "SEMI_VARIABLE", 50],
      ["7000", "Central Overheads", "P&L", "Operating Costs", -1, "FIXED", 60],
    ];
    const accId = {};
    for (const [code, name, stmt, grp2, sign, fv, sort] of accounts) {
      const { rows } = await client.query(
        `INSERT INTO core.dim_account
          (account_code, account_name, statement_type, account_group, natural_sign, fixed_variable_flag, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING account_id`,
        [code, name, stmt, grp2, sign, fv, sort]
      );
      accId[code] = rows[0].account_id;
    }

    // --- Scenarios -------------------------------------------------------
    const scId = {};
    for (const [code, name, type] of [
      ["ACT-2025", "Actual", "ACTUAL"],
      ["BUD-2025", "Budget FY25/26", "BUDGET"],
      ["FC-2025", "Forecast FY25/26", "FORECAST"],
    ]) {
      const { rows } = await client.query(
        `INSERT INTO core.dim_scenario (scenario_code, scenario_name, scenario_type, status)
         VALUES ($1,$2,$3,'APPROVED') RETURNING scenario_id`,
        [code, name, type]
      );
      scId[type] = rows[0].scenario_id;
    }

    // --- Products --------------------------------------------------------
    const products = [
      ["SKU-001", "Plush Toy", "Toys"], ["SKU-002", "Water Bottle", "Home"],
      ["SKU-003", "Notebook", "Stationery"], ["SKU-004", "Cosmetics Set", "Beauty"],
      ["SKU-005", "Phone Case", "Electronics"], ["SKU-006", "Scented Candle", "Home"],
    ];
    const prodIds = [];
    for (const [sku, name, cat] of products) {
      const { rows } = await client.query(
        `INSERT INTO core.dim_product (sku_code, product_name, category, brand, source_type)
         VALUES ($1,$2,$3,'MINISO','IMPORT') RETURNING product_id`,
        [sku, name, cat]
      );
      prodIds.push({ id: rows[0].product_id, cat });
    }

    // --- Monthly financials (Actual / Budget / Forecast) -----------------
    // Actuals only exist for the months up to "today"; budget & forecast run
    // for the whole fiscal year.
    const today = 20260717;
    const monthKeys = dates.map(dateKey).filter((k) => k >= 20250401 && k <= 20260331);
    // Base monthly group revenue and cost ratios.
    const baseRev = 1_450_000;
    for (const dk of monthKeys) {
      const seasonal = 1 + 0.18 * Math.sin(((dk % 10000) / 100) / 12 * 2 * Math.PI); // rough seasonality
      const revActual = jitter(baseRev * seasonal, 0.04);
      const revBudget = Math.round(baseRev * seasonal * 1.02);
      const revForecast = Math.round(baseRev * seasonal * 0.99);
      const rows = [
        ["4000", revActual, revBudget, revForecast],
        ["5000", -Math.round(revActual * 0.55), -Math.round(revBudget * 0.54), -Math.round(revForecast * 0.55)],
        ["6000", -Math.round(revActual * 0.13), -Math.round(revBudget * 0.12), -Math.round(revForecast * 0.13)],
        ["6100", -190_000, -185_000, -190_000],
        ["6200", -Math.round(revActual * 0.05), -Math.round(revBudget * 0.05), -Math.round(revForecast * 0.05)],
        ["7000", -165_000, -160_000, -165_000],
      ];
      for (const [code, act, bud, fc] of rows) {
        if (dk <= today) {
          await client.query(
            `INSERT INTO finance.fact_financials (date_key, entity_id, account_id, scenario_id, amount_gbp, amount_local, source_system)
             VALUES ($1,$2,$3,$4,$5,$5,'DEMO')`,
            [dk, retail.entity_id, accId[code], scId.ACTUAL, act]
          );
        }
        await client.query(
          `INSERT INTO finance.fact_financials (date_key, entity_id, account_id, scenario_id, amount_gbp, amount_local, source_system)
           VALUES ($1,$2,$3,$4,$5,$5,'DEMO'),($1,$2,$3,$6,$7,$7,'DEMO')`,
          [dk, retail.entity_id, accId[code], scId.BUDGET, bud, scId.FORECAST, fc]
        );
      }
    }

    // --- Store sales + store KPIs (latest actual month) ------------------
    const latestActual = monthKeys.filter((k) => k <= today).pop();
    for (const [code] of stores) {
      const sid = storeIds[code];
      const isEcom = code.startsWith("E");
      const sqft = stores.find((s) => s[0] === code)[5] || 1;
      const net = jitter(isEcom ? 240_000 : 165_000, 0.25);
      const gm = Math.round(net * (0.42 + rnd() * 0.06));
      const labour = Math.round(net * (0.11 + rnd() * 0.04));
      for (const p of prodIds) {
        const pnet = Math.round(net / prodIds.length);
        await client.query(
          `INSERT INTO commercial.fact_store_sales
            (date_key, store_id, product_id, scenario_id, gross_sales, discounts, net_sales, units_sold, transactions, gross_margin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [latestActual, sid, p.id, scId.ACTUAL, Math.round(pnet * 1.08), Math.round(pnet * 0.08), pnet,
           Math.round(pnet / 6), Math.round(pnet / 12), Math.round(gm / prodIds.length)]
        );
      }
      await client.query(
        `INSERT INTO commercial.fact_store_kpi
          (date_key, store_id, scenario_id, labour_cost, labour_hours, occupancy_cost, controllable_cost,
           ebitda, break_even_sales, sales_per_sqft, sales_per_labour_hr, conversion_pct, avg_transaction, forecast_accuracy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [latestActual, sid, scId.ACTUAL, labour, Math.round(labour / 13), Math.round(net * 0.14),
         Math.round(net * 0.08), Math.round(gm - labour - net * 0.22), Math.round(net * 0.78),
         sqft ? +(net / sqft).toFixed(2) : 0, +(net / Math.max(1, labour / 13)).toFixed(2),
         +(0.28 + rnd() * 0.1).toFixed(4), +(6.5 + rnd() * 2).toFixed(2), +(0.9 + rnd() * 0.08).toFixed(4)]
      );
    }

    // --- Franchise -------------------------------------------------------
    for (const code of ["F101", "F102"]) {
      const sid = storeIds[code];
      const inv = jitter(120_000, 0.2);
      await client.query(
        `INSERT INTO commercial.fact_franchise
          (date_key, store_id, scenario_id, invoiced_sales, cash_received, closing_receivable, overdue_receivable,
           stock_allocated, royalty_income, gross_margin, franchise_ebitda, credit_limit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [latestActual, sid, scId.ACTUAL, inv, Math.round(inv * 0.85), Math.round(inv * 0.4),
         Math.round(inv * (0.05 + rnd() * 0.1)), Math.round(inv * 0.7), Math.round(inv * 0.06),
         Math.round(inv * 0.28), Math.round(inv * 0.12), 200_000]
      );
    }

    // --- Inventory -------------------------------------------------------
    for (const code of ["S001", "S002", "S003", "S004", "S005", "E900"]) {
      const sid = storeIds[code];
      for (const p of prodIds) {
        const units = jitter(1500, 0.4);
        const wac = +(2 + rnd() * 6).toFixed(4);
        const age = Math.floor(rnd() * 240);
        await client.query(
          `INSERT INTO operations.fact_inventory
            (date_key, store_id, product_id, location_type, units_on_hand, stock_value, weighted_avg_cost,
             selling_price, stock_age_days, weeks_cover, availability_pct, sell_through_pct)
           VALUES ($1,$2,$3,'STORE',$4,$5,$6,$7,$8,$9,$10,$11)`,
          [latestActual, sid, p.id, units, +(units * wac).toFixed(2), wac, +(wac * 2.3).toFixed(4),
           age, +(2 + rnd() * 10).toFixed(4), +(0.88 + rnd() * 0.1).toFixed(4), +(0.4 + rnd() * 0.4).toFixed(4)]
        );
      }
    }

    // --- Bank position + cash flow --------------------------------------
    await client.query(
      `INSERT INTO finance.fact_bank_position
        (date_key, entity_id, bank_name, account_name, currency_code, ledger_balance, available_balance,
         facility_limit, facility_used, headroom, is_reconciled)
       VALUES
        ($1,$2,'HSBC','Current Account','GBP',1850000,1850000,3000000,900000,2100000,true),
        ($1,$2,'HSBC','Deposit Account','GBP',1200000,1200000,0,0,0,true)`,
      [latestActual, grp.entity_id]
    );
    for (const [cat, sub, amt, committed] of [
      ["Operating", "Receipts from sales", 1650000, true],
      ["Operating", "Supplier payments", -720000, true],
      ["Operating", "Payroll", -410000, true],
      ["Investing", "Store fit-out capex", -180000, false],
      ["Financing", "Facility repayment", -75000, true],
    ]) {
      await client.query(
        `INSERT INTO finance.fact_cashflow
          (date_key, entity_id, scenario_id, cashflow_category, cashflow_subcategory, amount_gbp, committed_flag, probability_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [latestActual, grp.entity_id, scId.FORECAST, cat, sub, amt, committed, committed ? 1 : 0.7]
      );
    }

    // --- Fixed assets ----------------------------------------------------
    for (const [code, desc, cat, cost, life, store] of [
      ["FA-001", "Oxford St fit-out", "Fit-out", 420000, 84, "S001"],
      ["FA-002", "Stratford fit-out", "Fit-out", 360000, 84, "S002"],
      ["FA-003", "EPOS hardware", "IT Equipment", 95000, 36, null],
      ["FA-004", "Warehouse racking", "Plant & Equipment", 140000, 120, null],
    ]) {
      const { rows } = await client.query(
        `INSERT INTO finance.dim_fixed_asset
          (asset_code, asset_description, entity_id, store_id, asset_category, acquisition_date, in_service_date,
           original_cost, useful_life_months, residual_value)
         VALUES ($1,$2,$3,$4,$5,'2024-06-30','2024-07-01',$6,$7,0) RETURNING asset_id`,
        [code, desc, retail.entity_id, store ? storeIds[store] : null, cat, cost, life]
      );
      const monthlyDep = Math.round(cost / life);
      await client.query(
        `INSERT INTO finance.fact_fixed_asset_monthly
          (date_key, asset_id, opening_nbv, additions, depreciation, closing_nbv, capex_budget, payback_months, roi_pct)
         VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8)`,
        [latestActual, rows[0].asset_id, cost - monthlyDep * 12, monthlyDep, cost - monthlyDep * 13,
         cost, +(life * 0.6).toFixed(2), +(0.12 + rnd() * 0.1).toFixed(4)]
      );
    }

    // --- KPI results (drive the Executive Hub) ---------------------------
    const { rows: kpis } = await client.query(`SELECT kpi_id, kpi_code, favourable_direction FROM intelligence.dim_kpi`);
    const kpiValues = {
      REVENUE_V_FORECAST: [1_480_000, 1_450_000],
      EBITDA_V_FORECAST: [172_000, 165_000],
      FORECAST_ACCURACY: [0.94, 0.95],
      STORE_LABOUR_PCT: [0.128, 0.12],
      STORE_EBITDA: [58_000, 62_000],
      INVENTORY_OVER_180: [210_000, 150_000],
      INVENTORY_AVAILABILITY: [0.93, 0.96],
      CASH_HEADROOM: [4_150_000, 3_500_000],
      FRANCHISE_OVERDUE: [24_500, 15_000],
      CAPEX_ROI: [0.14, 0.12],
    };
    for (const k of kpis) {
      const [actual, target] = kpiValues[k.kpi_code] || [0, 0];
      const variance = actual - target;
      const favUp = k.favourable_direction === "UP";
      const good = favUp ? actual >= target : actual <= target;
      const near = Math.abs(variance) / (Math.abs(target) || 1) < 0.05;
      const status = good ? "GREEN" : near ? "AMBER" : "RED";
      await client.query(
        `INSERT INTO intelligence.fact_kpi_result
          (date_key, kpi_id, entity_id, actual_value, target_value, variance_value, variance_pct, status, trend, confidence_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [latestActual, k.kpi_id, grp.entity_id, actual, target, variance,
         +((variance / (Math.abs(target) || 1))).toFixed(6), status,
         variance > 0 ? "UP" : variance < 0 ? "DOWN" : "FLAT", 0.9]
      );
    }

    // --- Sample AI insights (require human review) -----------------------
    const insights = [
      ["CASHFLOW", "OPPORTUNITY", "MEDIUM", "£2.1m facility headroom available",
       "Group cash plus undrawn HSBC facility gives £4.15m of headroom against a £3.5m comfort target. Surplus could fund Q3 store fit-outs without new borrowing.",
       "Review capex phasing with Build team before drawing on the facility.", 2_100_000, "Kris"],
      ["INVENTORY", "RISK", "HIGH", "Stock over 180 days is £60k above target",
       "Aged inventory (>180 days) sits at £210k versus a £150k target, concentrated in Home and Beauty. Working capital is tied up and markdown risk is rising.",
       "Agree a clearance markdown plan for aged Home/Beauty lines within 2 weeks.", -60_000, "Santosh"],
      ["FRANCHISE", "RISK", "MEDIUM", "Franchise overdue receivables at £24.5k",
       "Overdue franchise receivables are £9.5k above the £15k tolerance, driven by the Cardiff account. Credit exposure is within limit but trending up.",
       "Contact Cardiff franchisee to agree a payment plan; review credit terms.", -9_500, "Sergio"],
    ];
    for (const [dash, type, sev, head, narr, action, impact, owner] of insights) {
      await client.query(
        `INSERT INTO intelligence.ai_insight
          (dashboard_code, entity_id, insight_type, severity, headline, narrative, recommended_action,
           financial_impact, confidence_pct, digital_colleague, human_review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')`,
        [dash, grp.entity_id, type, sev, head, narr, action, impact, 0.85, owner]
      );
    }

    await client.query("COMMIT");
    console.log("Demo data loaded:");
    console.log("  3 entities, 8 stores, 6 accounts, 3 scenarios, 6 products");
    console.log(`  ${monthKeys.length} months of financials (actual/budget/forecast)`);
    console.log("  store sales & KPIs, franchise, inventory, cash, fixed assets");
    console.log("  10 KPI results and 3 sample AI insights (pending review)");
    console.log("\nEvery figure is illustrative demo data. Replace with real feeds when ready.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

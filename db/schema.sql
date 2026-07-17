/* ============================================================================
   MINISO UK — Finance Operating System
   Database foundation for the connected dashboard ecosystem.
   Target platform: PostgreSQL 15+

   Dashboard layers supported:
     1. Strategic Planning       - Budget & Forecast
     2. Performance Management   - Management Accounts vs Forecast/Budget
     3. Operational Intelligence - Stores, Franchise, Fixed Assets, Inventory, Cash Flow
     4. Executive Intelligence   - Master dashboard / business operating system

   Design principles:
     - One version of the truth
     - Actual, budget and forecast held at a common grain
     - Store/entity/product/account dimensions shared across every dashboard
     - Separate source data from curated reporting views
     - AI commentary and recommendations stored with a full audit trail
     - Human ownership and sign-off remain explicit

   This file is safe to run repeatedly (idempotent). It is executed by
   `npm run init-db` after the core app tables are created.
   ============================================================================ */

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS intelligence;
CREATE SCHEMA IF NOT EXISTS governance;

/* ================================================================
   1. CORE DIMENSIONS
   ================================================================ */

CREATE TABLE IF NOT EXISTS core.dim_date (
    date_key            integer PRIMARY KEY,
    calendar_date       date NOT NULL UNIQUE,
    day_name            varchar(12) NOT NULL,
    week_start_date     date NOT NULL,
    month_number        smallint NOT NULL CHECK (month_number BETWEEN 1 AND 12),
    month_name          varchar(12) NOT NULL,
    quarter_number      smallint NOT NULL CHECK (quarter_number BETWEEN 1 AND 4),
    calendar_year       integer NOT NULL,
    fiscal_month        smallint NOT NULL CHECK (fiscal_month BETWEEN 1 AND 12),
    fiscal_quarter      smallint NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    fiscal_year         integer NOT NULL,
    is_month_end        boolean NOT NULL DEFAULT false,
    is_weekend          boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS core.dim_entity (
    entity_id           bigserial PRIMARY KEY,
    entity_code         varchar(30) NOT NULL UNIQUE,
    entity_name         varchar(150) NOT NULL,
    entity_type         varchar(30) NOT NULL,
    parent_entity_id    bigint REFERENCES core.dim_entity(entity_id),
    currency_code       char(3) NOT NULL DEFAULT 'GBP',
    is_active           boolean NOT NULL DEFAULT true,
    valid_from          date NOT NULL DEFAULT CURRENT_DATE,
    valid_to            date
);

CREATE TABLE IF NOT EXISTS core.dim_store (
    store_id            bigserial PRIMARY KEY,
    store_code          varchar(30) NOT NULL UNIQUE,
    store_name          varchar(150) NOT NULL,
    entity_id           bigint NOT NULL REFERENCES core.dim_entity(entity_id),
    ownership_type      varchar(20) NOT NULL CHECK (ownership_type IN ('COMPANY','FRANCHISE','ECOMMERCE','OTHER')),
    region              varchar(80),
    area_manager        varchar(120),
    opening_date        date,
    closing_date        date,
    selling_sqft        numeric(14,2),
    total_sqft          numeric(14,2),
    store_format        varchar(50),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE',
    is_comparable       boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS core.dim_account (
    account_id          bigserial PRIMARY KEY,
    account_code        varchar(40) NOT NULL UNIQUE,
    account_name        varchar(160) NOT NULL,
    statement_type      varchar(20) NOT NULL CHECK (statement_type IN ('P&L','BALANCE_SHEET','CASH_FLOW','MEMO')),
    account_group       varchar(80),
    account_subgroup    varchar(80),
    natural_sign        smallint NOT NULL DEFAULT 1 CHECK (natural_sign IN (-1,1)),
    fixed_variable_flag varchar(20) CHECK (fixed_variable_flag IN ('FIXED','VARIABLE','SEMI_VARIABLE','NA')),
    controllable_flag   boolean NOT NULL DEFAULT false,
    sort_order          integer,
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS core.dim_department (
    department_id       bigserial PRIMARY KEY,
    department_code     varchar(30) NOT NULL UNIQUE,
    department_name     varchar(120) NOT NULL,
    finance_owner       varchar(120),
    business_owner      varchar(120),
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS core.dim_product (
    product_id          bigserial PRIMARY KEY,
    sku_code            varchar(60) NOT NULL UNIQUE,
    product_name        varchar(200),
    category            varchar(100),
    subcategory         varchar(100),
    brand               varchar(100),
    source_type         varchar(30),
    launch_date         date,
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS core.dim_scenario (
    scenario_id         bigserial PRIMARY KEY,
    scenario_code       varchar(30) NOT NULL UNIQUE,
    scenario_name       varchar(100) NOT NULL,
    scenario_type       varchar(20) NOT NULL CHECK (scenario_type IN ('ACTUAL','BUDGET','FORECAST','REFORECAST','PLAN','STRESS','OTHER')),
    version_number      integer NOT NULL DEFAULT 1,
    horizon_start       date,
    horizon_end         date,
    status              varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','LOCKED','SUPERSEDED')),
    approved_by         varchar(120),
    approved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scenario_code, version_number)
);

/* ================================================================
   2. FINANCIAL ACTUALS, BUDGET AND FORECAST
   ================================================================ */

CREATE TABLE IF NOT EXISTS finance.fact_financials (
    financial_id        bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    entity_id           bigint NOT NULL REFERENCES core.dim_entity(entity_id),
    store_id            bigint REFERENCES core.dim_store(store_id),
    department_id       bigint REFERENCES core.dim_department(department_id),
    account_id          bigint NOT NULL REFERENCES core.dim_account(account_id),
    scenario_id         bigint NOT NULL REFERENCES core.dim_scenario(scenario_id),
    amount_local        numeric(20,2) NOT NULL DEFAULT 0,
    amount_gbp          numeric(20,2) NOT NULL DEFAULT 0,
    currency_code       char(3) NOT NULL DEFAULT 'GBP',
    source_system       varchar(60),
    source_reference    varchar(120),
    loaded_at           timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

/* A UNIQUE constraint cannot contain expressions in PostgreSQL, so the
   "one row per grain" rule is enforced with a unique INDEX instead. This is
   the corrected form of the original UNIQUE(... COALESCE ...) clause. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_financials_grain
    ON finance.fact_financials
    (date_key, entity_id, COALESCE(store_id,0), COALESCE(department_id,0),
     account_id, scenario_id, COALESCE(source_reference,''));

CREATE INDEX IF NOT EXISTS idx_financials_period_scenario ON finance.fact_financials(date_key, scenario_id);
CREATE INDEX IF NOT EXISTS idx_financials_store ON finance.fact_financials(store_id);
CREATE INDEX IF NOT EXISTS idx_financials_account ON finance.fact_financials(account_id);

CREATE TABLE IF NOT EXISTS finance.fact_management_account_commentary (
    commentary_id       bigserial PRIMARY KEY,
    period_end          date NOT NULL,
    entity_id           bigint REFERENCES core.dim_entity(entity_id),
    store_id            bigint REFERENCES core.dim_store(store_id),
    account_id          bigint REFERENCES core.dim_account(account_id),
    comparison_type     varchar(30) NOT NULL CHECK (comparison_type IN ('ACTUAL_V_BUDGET','ACTUAL_V_FORECAST','FORECAST_V_BUDGET','OTHER')),
    variance_amount     numeric(20,2),
    variance_percent    numeric(12,4),
    root_cause          text,
    management_action   text,
    action_owner        varchar(120),
    due_date            date,
    status              varchar(20) NOT NULL DEFAULT 'OPEN',
    prepared_by         varchar(120),
    reviewed_by         varchar(120),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

/* ================================================================
   3. STORE SALES AND KPI DASHBOARD
   ================================================================ */

CREATE TABLE IF NOT EXISTS commercial.fact_store_sales (
    sales_id            bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    store_id            bigint NOT NULL REFERENCES core.dim_store(store_id),
    product_id          bigint REFERENCES core.dim_product(product_id),
    scenario_id         bigint NOT NULL REFERENCES core.dim_scenario(scenario_id),
    gross_sales         numeric(20,2) NOT NULL DEFAULT 0,
    discounts           numeric(20,2) NOT NULL DEFAULT 0,
    net_sales           numeric(20,2) NOT NULL DEFAULT 0,
    units_sold          numeric(20,4) NOT NULL DEFAULT 0,
    transactions        integer NOT NULL DEFAULT 0,
    gross_margin        numeric(20,2),
    footfall            integer,
    loaded_at           timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commercial.fact_store_kpi (
    store_kpi_id        bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    store_id            bigint NOT NULL REFERENCES core.dim_store(store_id),
    scenario_id         bigint NOT NULL REFERENCES core.dim_scenario(scenario_id),
    labour_cost         numeric(20,2),
    labour_hours        numeric(14,2),
    occupancy_cost      numeric(20,2),
    controllable_cost   numeric(20,2),
    ebitda              numeric(20,2),
    break_even_sales    numeric(20,2),
    stock_value         numeric(20,2),
    availability_pct    numeric(9,4),
    sales_per_sqft      numeric(20,4),
    sales_per_labour_hr numeric(20,4),
    conversion_pct      numeric(9,4),
    avg_transaction     numeric(20,4),
    forecast_accuracy   numeric(9,4),
    UNIQUE (date_key, store_id, scenario_id)
);

/* ================================================================
   4. FRANCHISE DASHBOARD
   ================================================================ */

CREATE TABLE IF NOT EXISTS commercial.fact_franchise (
    franchise_fact_id   bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    store_id            bigint NOT NULL REFERENCES core.dim_store(store_id),
    scenario_id         bigint NOT NULL REFERENCES core.dim_scenario(scenario_id),
    invoiced_sales      numeric(20,2) NOT NULL DEFAULT 0,
    cash_received       numeric(20,2) NOT NULL DEFAULT 0,
    closing_receivable  numeric(20,2) NOT NULL DEFAULT 0,
    overdue_receivable  numeric(20,2) NOT NULL DEFAULT 0,
    stock_allocated     numeric(20,2),
    royalty_income      numeric(20,2),
    gross_margin        numeric(20,2),
    franchise_ebitda    numeric(20,2),
    credit_limit        numeric(20,2),
    UNIQUE (date_key, store_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS commercial.fact_franchise_helpdesk (
    ticket_id           bigserial PRIMARY KEY,
    store_id            bigint REFERENCES core.dim_store(store_id),
    opened_at           timestamptz NOT NULL,
    first_response_at   timestamptz,
    resolved_at         timestamptz,
    query_category      varchar(80),
    priority            varchar(20),
    status              varchar(20) NOT NULL,
    owner_name          varchar(120),
    resolution_summary  text,
    root_cause          text,
    permanently_fixed   boolean NOT NULL DEFAULT false,
    ai_assisted         boolean NOT NULL DEFAULT false
);

/* ================================================================
   5. FIXED ASSET DASHBOARD
   ================================================================ */

CREATE TABLE IF NOT EXISTS finance.dim_fixed_asset (
    asset_id            bigserial PRIMARY KEY,
    asset_code          varchar(50) NOT NULL UNIQUE,
    asset_description   varchar(200) NOT NULL,
    entity_id           bigint NOT NULL REFERENCES core.dim_entity(entity_id),
    store_id            bigint REFERENCES core.dim_store(store_id),
    asset_category      varchar(80) NOT NULL,
    acquisition_date    date NOT NULL,
    in_service_date     date,
    original_cost       numeric(20,2) NOT NULL,
    useful_life_months  integer NOT NULL,
    residual_value      numeric(20,2) NOT NULL DEFAULT 0,
    depreciation_method varchar(40) NOT NULL DEFAULT 'STRAIGHT_LINE',
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE',
    disposal_date       date,
    disposal_proceeds   numeric(20,2)
);

CREATE TABLE IF NOT EXISTS finance.fact_fixed_asset_monthly (
    asset_month_id      bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    asset_id            bigint NOT NULL REFERENCES finance.dim_fixed_asset(asset_id),
    opening_nbv         numeric(20,2) NOT NULL DEFAULT 0,
    additions           numeric(20,2) NOT NULL DEFAULT 0,
    depreciation        numeric(20,2) NOT NULL DEFAULT 0,
    impairment          numeric(20,2) NOT NULL DEFAULT 0,
    disposals_nbv       numeric(20,2) NOT NULL DEFAULT 0,
    closing_nbv         numeric(20,2) NOT NULL DEFAULT 0,
    capex_budget        numeric(20,2),
    payback_months      numeric(12,2),
    roi_pct             numeric(9,4),
    UNIQUE (date_key, asset_id)
);

/* ================================================================
   6. INVENTORY DASHBOARD
   ================================================================ */

CREATE TABLE IF NOT EXISTS operations.fact_inventory (
    inventory_id        bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    store_id            bigint REFERENCES core.dim_store(store_id),
    product_id          bigint NOT NULL REFERENCES core.dim_product(product_id),
    location_type       varchar(30) NOT NULL,
    units_on_hand       numeric(20,4) NOT NULL DEFAULT 0,
    stock_value         numeric(20,2) NOT NULL DEFAULT 0,
    weighted_avg_cost   numeric(20,6),
    selling_price       numeric(20,4),
    stock_age_days      integer,
    weeks_cover         numeric(12,4),
    units_in_transit    numeric(20,4) NOT NULL DEFAULT 0,
    value_in_transit    numeric(20,2) NOT NULL DEFAULT 0,
    purchase_order_open numeric(20,2) NOT NULL DEFAULT 0,
    availability_pct    numeric(9,4),
    sell_through_pct    numeric(9,4)
);

/* Corrected form of the original UNIQUE(... COALESCE ...) clause. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_grain
    ON operations.fact_inventory
    (date_key, COALESCE(store_id,0), product_id, location_type);

CREATE TABLE IF NOT EXISTS operations.fact_inventory_movement (
    movement_id         bigserial PRIMARY KEY,
    movement_date       date NOT NULL,
    store_id            bigint REFERENCES core.dim_store(store_id),
    product_id          bigint NOT NULL REFERENCES core.dim_product(product_id),
    movement_type       varchar(40) NOT NULL,
    units               numeric(20,4) NOT NULL,
    value_gbp           numeric(20,2) NOT NULL,
    purchase_order_ref  varchar(80),
    allocation_ref      varchar(80),
    source_reference    varchar(120)
);

/* ================================================================
   7. CASH FLOW AND TREASURY DASHBOARD
   ================================================================ */

CREATE TABLE IF NOT EXISTS finance.fact_cashflow (
    cashflow_id         bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    entity_id           bigint NOT NULL REFERENCES core.dim_entity(entity_id),
    scenario_id         bigint NOT NULL REFERENCES core.dim_scenario(scenario_id),
    cashflow_category   varchar(80) NOT NULL,
    cashflow_subcategory varchar(100),
    amount_gbp          numeric(20,2) NOT NULL DEFAULT 0,
    committed_flag      boolean NOT NULL DEFAULT false,
    probability_pct     numeric(9,4),
    source_reference    varchar(120)
);

CREATE TABLE IF NOT EXISTS finance.fact_bank_position (
    bank_position_id    bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    entity_id           bigint NOT NULL REFERENCES core.dim_entity(entity_id),
    bank_name           varchar(80) NOT NULL,
    account_name        varchar(120) NOT NULL,
    currency_code       char(3) NOT NULL,
    ledger_balance      numeric(20,2) NOT NULL,
    available_balance   numeric(20,2),
    facility_limit      numeric(20,2),
    facility_used       numeric(20,2),
    headroom            numeric(20,2),
    is_reconciled       boolean NOT NULL DEFAULT false,
    UNIQUE (date_key, entity_id, bank_name, account_name)
);

/* ================================================================
   8. KPI CATALOGUE AND DASHBOARD REGISTRY
   ================================================================ */

CREATE TABLE IF NOT EXISTS intelligence.dim_kpi (
    kpi_id              bigserial PRIMARY KEY,
    kpi_code            varchar(60) NOT NULL UNIQUE,
    kpi_name            varchar(160) NOT NULL,
    dashboard_domain    varchar(60) NOT NULL,
    description         text,
    calculation_logic   text NOT NULL,
    unit_of_measure     varchar(30),
    favourable_direction varchar(20) CHECK (favourable_direction IN ('UP','DOWN','TARGET','RANGE')),
    green_threshold     numeric(20,6),
    amber_threshold     numeric(20,6),
    frequency           varchar(20),
    business_owner      varchar(120),
    finance_owner       varchar(120),
    digital_colleague   varchar(120),
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS intelligence.fact_kpi_result (
    kpi_result_id       bigserial PRIMARY KEY,
    date_key            integer NOT NULL REFERENCES core.dim_date(date_key),
    kpi_id              bigint NOT NULL REFERENCES intelligence.dim_kpi(kpi_id),
    entity_id           bigint REFERENCES core.dim_entity(entity_id),
    store_id            bigint REFERENCES core.dim_store(store_id),
    scenario_id         bigint REFERENCES core.dim_scenario(scenario_id),
    actual_value        numeric(20,6),
    target_value        numeric(20,6),
    variance_value      numeric(20,6),
    variance_pct        numeric(12,6),
    status              varchar(10) CHECK (status IN ('GREEN','AMBER','RED','INFO')),
    trend               varchar(10) CHECK (trend IN ('UP','DOWN','FLAT')),
    confidence_pct      numeric(9,4),
    calculated_at       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intelligence.dashboard_registry (
    dashboard_id        bigserial PRIMARY KEY,
    dashboard_code      varchar(60) NOT NULL UNIQUE,
    dashboard_name      varchar(160) NOT NULL,
    dashboard_layer     smallint NOT NULL CHECK (dashboard_layer BETWEEN 1 AND 4),
    purpose             text NOT NULL,
    primary_audience    varchar(200),
    finance_owner       varchar(120),
    digital_colleague   varchar(120),
    refresh_frequency   varchar(30),
    source_view         varchar(160),
    display_order       integer,
    is_active           boolean NOT NULL DEFAULT true
);

INSERT INTO intelligence.dashboard_registry
    (dashboard_code, dashboard_name, dashboard_layer, purpose, primary_audience, finance_owner, digital_colleague, refresh_frequency, source_view, display_order)
VALUES
    ('BUDGET_FORECAST', 'Budget & Forecast Dashboard', 1, 'Show the long-term financial direction of the business and support strategic decisions today.', 'Board, CEO, COO, Finance Director', 'Kris', 'Executive Intelligence Colleague', 'Monthly', 'intelligence.vw_actual_budget_forecast', 10),
    ('MANAGEMENT_ACCOUNTS', 'Management Accounts Dashboard', 2, 'Explain current performance against budget and forecast, including variance, KPI and action ownership.', 'SLT, Finance, Budget Holders', 'Sergio', 'Finance Intelligence Colleague', 'Monthly', 'intelligence.vw_management_accounts_variance', 20),
    ('STORE_SALES_KPI', 'Store Sales & KPI Dashboard', 3, 'Provide store-level sales, labour, margin, productivity and performance intelligence.', 'Operations, Area Managers, Finance', 'Farheen', 'Retail Performance Colleague', 'Daily', 'intelligence.vw_store_performance', 30),
    ('FRANCHISE', 'Franchise Dashboard', 3, 'Monitor franchise performance, receivables, allocations, profitability and service levels.', 'Franchise Team, Finance, SLT', 'Sergio', 'Franchise Finance Colleague', 'Weekly', NULL, 40),
    ('FIXED_ASSETS', 'Fixed Asset Dashboard', 3, 'Track capital investment, depreciation, ROI, payback and asset utilisation.', 'Finance, Build Team, Board', 'Santosh', 'Finance Assurance Colleague', 'Monthly', NULL, 50),
    ('INVENTORY', 'Inventory Dashboard', 3, 'Protect inventory integrity, working capital, availability, ageing, WAC and allocation quality.', 'Merchandising, Logistics, Finance', 'Santosh', 'Inventory Intelligence Colleague', 'Daily', 'intelligence.vw_inventory_health', 60),
    ('CASHFLOW', 'Cash Flow Dashboard', 3, 'Show cash position, liquidity, funding headroom, commitments and future cash requirements.', 'Finance Director, CEO, Board', 'Kris', 'Executive Intelligence Colleague', 'Daily', 'intelligence.vw_cash_headroom', 70),
    ('MASTER', 'Executive Intelligence Hub', 4, 'Consolidate the most important signals from every dashboard into one executive operating view.', 'CEO, COO, Board, Finance Director', 'Kris', 'Executive Intelligence Colleague', 'Daily', 'intelligence.vw_executive_intelligence_hub', 100)
ON CONFLICT (dashboard_code) DO NOTHING;

/* ================================================================
   9. AI INSIGHT, RECOMMENDATION AND GOVERNANCE
   ================================================================ */

CREATE TABLE IF NOT EXISTS intelligence.ai_insight (
    insight_id          bigserial PRIMARY KEY,
    generated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dashboard_code      varchar(60) NOT NULL REFERENCES intelligence.dashboard_registry(dashboard_code),
    period_start        date,
    period_end          date,
    entity_id           bigint REFERENCES core.dim_entity(entity_id),
    store_id            bigint REFERENCES core.dim_store(store_id),
    insight_type        varchar(30) NOT NULL CHECK (insight_type IN ('RISK','OPPORTUNITY','COMMENTARY','ANOMALY','RECOMMENDATION','FORECAST_CHANGE')),
    severity            varchar(10) CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    headline            varchar(250) NOT NULL,
    narrative           text NOT NULL,
    recommended_action  text,
    financial_impact    numeric(20,2),
    confidence_pct      numeric(9,4),
    digital_colleague   varchar(120),
    source_references   jsonb,
    human_review_status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (human_review_status IN ('PENDING','APPROVED','REJECTED','AMENDED')),
    reviewed_by         varchar(120),
    reviewed_at         timestamptz
);

CREATE TABLE IF NOT EXISTS intelligence.action_register (
    action_id           bigserial PRIMARY KEY,
    insight_id          bigint REFERENCES intelligence.ai_insight(insight_id),
    action_title        varchar(250) NOT NULL,
    action_description  text,
    owner_name          varchar(120) NOT NULL,
    due_date            date,
    status              varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETE','CANCELLED','OVERDUE')),
    expected_value_gbp  numeric(20,2),
    realised_value_gbp  numeric(20,2),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        timestamptz
);

CREATE TABLE IF NOT EXISTS governance.data_refresh_log (
    refresh_id          bigserial PRIMARY KEY,
    dashboard_code      varchar(60) REFERENCES intelligence.dashboard_registry(dashboard_code),
    source_system       varchar(80) NOT NULL,
    started_at          timestamptz NOT NULL,
    completed_at        timestamptz,
    status              varchar(20) NOT NULL CHECK (status IN ('STARTED','SUCCESS','WARNING','FAILED')),
    rows_loaded         bigint,
    error_message       text
);

CREATE TABLE IF NOT EXISTS governance.signoff_log (
    signoff_id          bigserial PRIMARY KEY,
    process_name        varchar(120) NOT NULL,
    period_end          date NOT NULL,
    entity_id           bigint REFERENCES core.dim_entity(entity_id),
    prepared_by         varchar(120),
    reviewed_by         varchar(120),
    approved_by         varchar(120),
    status              varchar(20) NOT NULL DEFAULT 'DRAFT',
    prepared_at         timestamptz,
    reviewed_at         timestamptz,
    approved_at         timestamptz,
    comments            text
);

/* ================================================================
   10. REPORTING VIEWS
   ================================================================ */

CREATE OR REPLACE VIEW intelligence.vw_actual_budget_forecast AS
SELECT
    d.calendar_date,
    d.fiscal_year,
    d.fiscal_month,
    e.entity_code,
    e.entity_name,
    s.store_code,
    s.store_name,
    a.account_code,
    a.account_name,
    a.account_group,
    sc.scenario_type,
    sc.scenario_name,
    SUM(f.amount_gbp) AS amount_gbp
FROM finance.fact_financials f
JOIN core.dim_date d ON d.date_key = f.date_key
JOIN core.dim_entity e ON e.entity_id = f.entity_id
LEFT JOIN core.dim_store s ON s.store_id = f.store_id
JOIN core.dim_account a ON a.account_id = f.account_id
JOIN core.dim_scenario sc ON sc.scenario_id = f.scenario_id
GROUP BY
    d.calendar_date, d.fiscal_year, d.fiscal_month,
    e.entity_code, e.entity_name,
    s.store_code, s.store_name,
    a.account_code, a.account_name, a.account_group,
    sc.scenario_type, sc.scenario_name;

CREATE OR REPLACE VIEW intelligence.vw_management_accounts_variance AS
WITH base AS (
    SELECT
        f.date_key,
        f.entity_id,
        f.store_id,
        f.department_id,
        f.account_id,
        SUM(f.amount_gbp) FILTER (WHERE sc.scenario_type = 'ACTUAL') AS actual_amount,
        SUM(f.amount_gbp) FILTER (WHERE sc.scenario_type = 'BUDGET') AS budget_amount,
        SUM(f.amount_gbp) FILTER (WHERE sc.scenario_type IN ('FORECAST','REFORECAST')) AS forecast_amount
    FROM finance.fact_financials f
    JOIN core.dim_scenario sc ON sc.scenario_id = f.scenario_id
    GROUP BY f.date_key, f.entity_id, f.store_id, f.department_id, f.account_id
)
SELECT
    b.*,
    b.actual_amount - b.budget_amount AS actual_vs_budget,
    b.actual_amount - b.forecast_amount AS actual_vs_forecast,
    b.forecast_amount - b.budget_amount AS forecast_vs_budget,
    CASE WHEN NULLIF(b.budget_amount,0) IS NULL THEN NULL
         ELSE (b.actual_amount - b.budget_amount) / ABS(b.budget_amount) END AS actual_vs_budget_pct,
    CASE WHEN NULLIF(b.forecast_amount,0) IS NULL THEN NULL
         ELSE (b.actual_amount - b.forecast_amount) / ABS(b.forecast_amount) END AS actual_vs_forecast_pct
FROM base b;

CREATE OR REPLACE VIEW intelligence.vw_store_performance AS
SELECT
    d.calendar_date,
    s.store_code,
    s.store_name,
    s.region,
    s.ownership_type,
    sc.scenario_type,
    SUM(fs.net_sales) AS net_sales,
    SUM(fs.gross_margin) AS gross_margin,
    SUM(fs.units_sold) AS units_sold,
    SUM(fs.transactions) AS transactions,
    MAX(k.labour_cost) AS labour_cost,
    MAX(k.ebitda) AS ebitda,
    MAX(k.break_even_sales) AS break_even_sales,
    MAX(k.sales_per_sqft) AS sales_per_sqft,
    MAX(k.sales_per_labour_hr) AS sales_per_labour_hr,
    MAX(k.forecast_accuracy) AS forecast_accuracy
FROM commercial.fact_store_sales fs
JOIN core.dim_date d ON d.date_key = fs.date_key
JOIN core.dim_store s ON s.store_id = fs.store_id
JOIN core.dim_scenario sc ON sc.scenario_id = fs.scenario_id
LEFT JOIN commercial.fact_store_kpi k
    ON k.date_key = fs.date_key
   AND k.store_id = fs.store_id
   AND k.scenario_id = fs.scenario_id
GROUP BY d.calendar_date, s.store_code, s.store_name, s.region, s.ownership_type, sc.scenario_type;

CREATE OR REPLACE VIEW intelligence.vw_inventory_health AS
SELECT
    d.calendar_date,
    s.store_code,
    s.store_name,
    p.category,
    SUM(i.stock_value) AS stock_value,
    SUM(i.units_on_hand) AS units_on_hand,
    SUM(i.value_in_transit) AS value_in_transit,
    AVG(i.weeks_cover) AS avg_weeks_cover,
    SUM(i.stock_value) FILTER (WHERE i.stock_age_days > 90) AS stock_over_90_days,
    SUM(i.stock_value) FILTER (WHERE i.stock_age_days > 180) AS stock_over_180_days,
    AVG(i.availability_pct) AS avg_availability_pct,
    AVG(i.sell_through_pct) AS avg_sell_through_pct
FROM operations.fact_inventory i
JOIN core.dim_date d ON d.date_key = i.date_key
LEFT JOIN core.dim_store s ON s.store_id = i.store_id
JOIN core.dim_product p ON p.product_id = i.product_id
GROUP BY d.calendar_date, s.store_code, s.store_name, p.category;

CREATE OR REPLACE VIEW intelligence.vw_cash_headroom AS
SELECT
    d.calendar_date,
    e.entity_code,
    e.entity_name,
    SUM(bp.available_balance) AS available_cash,
    SUM(bp.facility_limit) AS facility_limit,
    SUM(bp.facility_used) AS facility_used,
    SUM(bp.headroom) AS total_headroom,
    BOOL_AND(bp.is_reconciled) AS all_accounts_reconciled
FROM finance.fact_bank_position bp
JOIN core.dim_date d ON d.date_key = bp.date_key
JOIN core.dim_entity e ON e.entity_id = bp.entity_id
GROUP BY d.calendar_date, e.entity_code, e.entity_name;

CREATE OR REPLACE VIEW intelligence.vw_executive_intelligence_hub AS
WITH latest_date AS (
    SELECT MAX(calendar_date) AS report_date FROM core.dim_date WHERE calendar_date <= CURRENT_DATE
),
latest_kpis AS (
    SELECT DISTINCT ON (k.kpi_id, COALESCE(r.entity_id,0), COALESCE(r.store_id,0))
        k.dashboard_domain,
        k.kpi_code,
        k.kpi_name,
        r.entity_id,
        r.store_id,
        r.actual_value,
        r.target_value,
        r.variance_value,
        r.variance_pct,
        r.status,
        r.trend,
        r.confidence_pct,
        d.calendar_date
    FROM intelligence.fact_kpi_result r
    JOIN intelligence.dim_kpi k ON k.kpi_id = r.kpi_id
    JOIN core.dim_date d ON d.date_key = r.date_key
    ORDER BY k.kpi_id, COALESCE(r.entity_id,0), COALESCE(r.store_id,0), d.calendar_date DESC
),
latest_insights AS (
    SELECT *
    FROM intelligence.ai_insight
    WHERE human_review_status IN ('PENDING','APPROVED','AMENDED')
      AND generated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
)
SELECT
    ld.report_date,
    lk.dashboard_domain,
    lk.kpi_code,
    lk.kpi_name,
    lk.entity_id,
    lk.store_id,
    lk.actual_value,
    lk.target_value,
    lk.variance_value,
    lk.variance_pct,
    lk.status,
    lk.trend,
    lk.confidence_pct,
    li.insight_id,
    li.insight_type,
    li.severity,
    li.headline,
    li.recommended_action,
    li.financial_impact,
    li.digital_colleague
FROM latest_date ld
LEFT JOIN latest_kpis lk ON true
LEFT JOIN latest_insights li
    ON li.dashboard_code = CASE lk.dashboard_domain
        WHEN 'STRATEGY' THEN 'BUDGET_FORECAST'
        WHEN 'MANAGEMENT_ACCOUNTS' THEN 'MANAGEMENT_ACCOUNTS'
        WHEN 'STORES' THEN 'STORE_SALES_KPI'
        WHEN 'FRANCHISE' THEN 'FRANCHISE'
        WHEN 'FIXED_ASSETS' THEN 'FIXED_ASSETS'
        WHEN 'INVENTORY' THEN 'INVENTORY'
        WHEN 'CASHFLOW' THEN 'CASHFLOW'
        ELSE 'MASTER'
    END;

/* ================================================================
   11. STARTER KPI CATALOGUE
   ================================================================ */

INSERT INTO intelligence.dim_kpi
(kpi_code, kpi_name, dashboard_domain, description, calculation_logic, unit_of_measure, favourable_direction, frequency, business_owner, finance_owner, digital_colleague)
VALUES
('REVENUE_V_FORECAST', 'Revenue vs Forecast', 'MANAGEMENT_ACCOUNTS', 'Current revenue compared with the latest approved forecast.', 'Actual revenue - Forecast revenue', 'GBP', 'UP', 'Monthly', 'Commercial', 'Sergio', 'Finance Intelligence Colleague'),
('EBITDA_V_FORECAST', 'EBITDA vs Forecast', 'MANAGEMENT_ACCOUNTS', 'Current EBITDA compared with the latest approved forecast.', 'Actual EBITDA - Forecast EBITDA', 'GBP', 'UP', 'Monthly', 'Executive Team', 'Kris', 'Executive Intelligence Colleague'),
('FORECAST_ACCURACY', 'Forecast Accuracy', 'STRATEGY', 'Accuracy of forecast against actual outcome.', '1 - ABS(Actual - Forecast) / ABS(Actual)', 'PERCENT', 'UP', 'Monthly', 'Executive Team', 'Kris', 'Executive Intelligence Colleague'),
('STORE_LABOUR_PCT', 'Store Labour %', 'STORES', 'Labour cost as a percentage of net sales.', 'Labour cost / Net sales', 'PERCENT', 'DOWN', 'Weekly', 'Operations', 'Farheen', 'Retail Performance Colleague'),
('STORE_EBITDA', 'Store EBITDA', 'STORES', 'Store earnings before interest, tax, depreciation and amortisation.', 'Net sales - direct and allocated operating costs', 'GBP', 'UP', 'Monthly', 'Operations', 'Farheen', 'Retail Performance Colleague'),
('INVENTORY_OVER_180', 'Inventory Over 180 Days', 'INVENTORY', 'Value of inventory aged more than 180 days.', 'SUM(stock value where age > 180 days)', 'GBP', 'DOWN', 'Weekly', 'Merchandising', 'Santosh', 'Inventory Intelligence Colleague'),
('INVENTORY_AVAILABILITY', 'Inventory Availability', 'INVENTORY', 'Percentage of ranged SKUs available to sell.', 'Available ranged SKUs / Total ranged SKUs', 'PERCENT', 'UP', 'Daily', 'Merchandising', 'Santosh', 'Inventory Intelligence Colleague'),
('CASH_HEADROOM', 'Cash and Facility Headroom', 'CASHFLOW', 'Available cash plus undrawn committed facilities.', 'Available bank balance + facility headroom', 'GBP', 'UP', 'Daily', 'Executive Team', 'Kris', 'Executive Intelligence Colleague'),
('FRANCHISE_OVERDUE', 'Franchise Overdue Receivables', 'FRANCHISE', 'Value of franchise receivables past due.', 'SUM(overdue receivable)', 'GBP', 'DOWN', 'Weekly', 'Franchise', 'Sergio', 'Franchise Finance Colleague'),
('CAPEX_ROI', 'Capital Investment ROI', 'FIXED_ASSETS', 'Return generated by capital investment.', 'Incremental annual cash return / Capital invested', 'PERCENT', 'UP', 'Monthly', 'Build Team', 'Santosh', 'Finance Assurance Colleague')
ON CONFLICT (kpi_code) DO NOTHING;

COMMIT;

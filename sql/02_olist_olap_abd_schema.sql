-- Schema DDL for database: olist_olap_abd
-- Replica of shared olist_olap (only DB name differs). Surrogate keys use SERIAL
-- (nextval sequences), matching shared — not GENERATED ... AS IDENTITY.
-- Apply: psql -d olist_olap_abd -v ON_ERROR_STOP=1 -f sql/02_olist_olap_abd_schema.sql
-- Populate only via KNIME (one workflow per dim/fact).

BEGIN;

DROP TABLE IF EXISTS fact_order_item CASCADE;
DROP TABLE IF EXISTS dim_seller CASCADE;
DROP TABLE IF EXISTS dim_customer CASCADE;
DROP TABLE IF EXISTS dim_product CASCADE;
DROP TABLE IF EXISTS dim_category CASCADE;
DROP TABLE IF EXISTS dim_geography CASCADE;
DROP TABLE IF EXISTS dim_date CASCADE;
DROP TABLE IF EXISTS dq_report CASCADE;

CREATE TABLE dim_date (
    date_key     integer PRIMARY KEY,
    full_date    date NOT NULL UNIQUE,
    year         integer NOT NULL,
    quarter      integer NOT NULL,
    month        integer NOT NULL,
    month_name   text NOT NULL,
    day          integer NOT NULL,
    day_of_week  integer NOT NULL,
    day_name     text NOT NULL,
    week_of_year integer NOT NULL
);

CREATE TABLE dim_geography (
    geo_key    serial PRIMARY KEY,
    zip_prefix text NOT NULL UNIQUE,
    city       text,
    state      text,
    latitude   double precision,
    longitude  double precision
);

CREATE TABLE dim_category (
    category_key          serial PRIMARY KEY,
    category_name_pt      text NOT NULL UNIQUE,
    category_name_english text
);

CREATE TABLE dim_product (
    product_key                serial PRIMARY KEY,
    product_id                 text NOT NULL UNIQUE,
    category_key               integer REFERENCES dim_category (category_key),
    product_name_lenght        integer,
    product_description_lenght integer,
    product_photos_qty         integer,
    product_weight_g           integer,
    product_length_cm          integer,
    product_height_cm          integer,
    product_width_cm           integer
);
CREATE INDEX idx_dim_product_category ON dim_product (category_key);

CREATE TABLE dim_customer (
    customer_key       serial PRIMARY KEY,
    customer_id        text NOT NULL UNIQUE,
    customer_unique_id text NOT NULL,
    geo_key            integer REFERENCES dim_geography (geo_key),
    customer_city      text,
    customer_state     text
);
CREATE INDEX idx_dim_customer_geo ON dim_customer (geo_key);
CREATE INDEX idx_dim_customer_unique ON dim_customer (customer_unique_id);

CREATE TABLE dim_seller (
    seller_key   serial PRIMARY KEY,
    seller_id    text NOT NULL UNIQUE,
    geo_key      integer REFERENCES dim_geography (geo_key),
    seller_city  text,
    seller_state text
);
CREATE INDEX idx_dim_seller_geo ON dim_seller (geo_key);

CREATE TABLE fact_order_item (
    order_id      text NOT NULL,
    order_item_id integer NOT NULL,
    order_status  text,
    date_key      integer REFERENCES dim_date (date_key),
    customer_key  integer REFERENCES dim_customer (customer_key),
    product_key   integer REFERENCES dim_product (product_key),
    seller_key    integer REFERENCES dim_seller (seller_key),
    category_key  integer REFERENCES dim_category (category_key),
    price         numeric(12,2),
    freight_value numeric(12,2),
    item_total    numeric(12,2),
    PRIMARY KEY (order_id, order_item_id)
);
CREATE INDEX idx_fact_order_item_date ON fact_order_item (date_key);
CREATE INDEX idx_fact_order_item_customer ON fact_order_item (customer_key);
CREATE INDEX idx_fact_order_item_product ON fact_order_item (product_key);
CREATE INDEX idx_fact_order_item_seller ON fact_order_item (seller_key);
CREATE INDEX idx_fact_order_item_category ON fact_order_item (category_key);
CREATE INDEX idx_fact_order_item_status ON fact_order_item (order_status);

CREATE TABLE dq_report (
    run_at     timestamp,
    table_name text,
    check_name text,
    value      bigint
);

COMMIT;

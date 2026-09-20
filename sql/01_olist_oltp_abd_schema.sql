-- Schema DDL for database: olist_oltp_abd
-- Replica of shared olist_oltp (only DB name differs). Same columns/PKs/FKs/indexes.
-- Apply: psql -d olist_oltp_abd -v ON_ERROR_STOP=1 -f sql/01_olist_oltp_abd_schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS product_category_name_translation (
    product_category_name         text PRIMARY KEY,
    product_category_name_english text NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id              text PRIMARY KEY,
    customer_unique_id       text NOT NULL,
    customer_zip_code_prefix text,
    customer_city            text,
    customer_state           text
);

CREATE TABLE IF NOT EXISTS geolocation (
    geolocation_zip_code_prefix text,
    geolocation_lat             double precision,
    geolocation_lng             double precision,
    geolocation_city            text,
    geolocation_state           text
);

CREATE TABLE IF NOT EXISTS products (
    product_id                 text PRIMARY KEY,
    product_category_name      text,
    product_name_lenght        integer,
    product_description_lenght integer,
    product_photos_qty         integer,
    product_weight_g           integer,
    product_length_cm          integer,
    product_height_cm          integer,
    product_width_cm           integer
);

CREATE TABLE IF NOT EXISTS sellers (
    seller_id              text PRIMARY KEY,
    seller_zip_code_prefix text,
    seller_city            text,
    seller_state           text
);

CREATE TABLE IF NOT EXISTS orders (
    order_id                      text PRIMARY KEY,
    customer_id                   text NOT NULL REFERENCES customers (customer_id),
    order_status                  text,
    order_purchase_timestamp      timestamp,
    order_approved_at             timestamp,
    order_delivered_carrier_date  timestamp,
    order_delivered_customer_date timestamp,
    order_estimated_delivery_date timestamp
);

CREATE TABLE IF NOT EXISTS order_items (
    order_id            text NOT NULL REFERENCES orders (order_id),
    order_item_id       integer NOT NULL,
    product_id          text REFERENCES products (product_id),
    seller_id           text REFERENCES sellers (seller_id),
    shipping_limit_date timestamp,
    price               numeric(12,2),
    freight_value       numeric(12,2),
    PRIMARY KEY (order_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS order_payments (
    order_id             text NOT NULL REFERENCES orders (order_id),
    payment_sequential   integer NOT NULL,
    payment_type         text,
    payment_installments integer,
    payment_value        numeric(12,2),
    PRIMARY KEY (order_id, payment_sequential)
);

CREATE TABLE IF NOT EXISTS order_reviews (
    review_id               text NOT NULL,
    order_id                text NOT NULL REFERENCES orders (order_id),
    review_score            integer,
    review_comment_title    text,
    review_comment_message  text,
    review_creation_date    timestamp,
    review_answer_timestamp timestamp,
    PRIMARY KEY (review_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_unique_id ON customers (customer_unique_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_purchase_ts ON orders (order_purchase_timestamp);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_seller_id ON order_items (seller_id);
CREATE INDEX IF NOT EXISTS idx_geolocation_zip ON geolocation (geolocation_zip_code_prefix);

COMMIT;

alter table public.sales_assessments
add column if not exists salesperson_ids uuid[] not null default '{}';

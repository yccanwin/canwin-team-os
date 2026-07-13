alter table public.sales_products
alter column points type numeric(10,1)
using round(points::numeric, 1);

alter table public.sales_score_records
alter column points type numeric(10,1)
using round(points::numeric, 1);

alter table public.sales_assessments
alter column point_target type numeric(10,1)
using round(point_target::numeric, 1);

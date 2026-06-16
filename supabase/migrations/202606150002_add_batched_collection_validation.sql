create or replace function public.validate_user_collection_batch(
  requested_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  validation_result jsonb;
begin
  begin
    validation_result := public.import_user_collection(
      requested_rows,
      'update'
    );

    -- Force this inner block to roll back the trial upsert while preserving
    -- the validation result for the outer block.
    raise exception 'ROLLBACK_COLLECTION_VALIDATION'
      using errcode = 'ZX001';
  exception
    when sqlstate 'ZX001' then
      return validation_result;
  end;
end;
$$;

grant execute on function public.validate_user_collection_batch(jsonb)
to authenticated;

notify pgrst, 'reload schema';

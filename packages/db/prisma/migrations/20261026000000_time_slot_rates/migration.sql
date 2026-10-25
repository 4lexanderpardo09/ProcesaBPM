-- The meal allowance becomes a general "pay by time slots" calculator: each organization names its rate tables and
-- their slots. A meal configuration turns into one table, "Comidas", with each meal as a slot named after its code.
-- Published versions keep their old code (they are immutable): the application resolves it to the new calculator.
UPDATE calculator_configs
SET code = 'TIME_SLOTS',
    config = jsonb_build_object('tables', jsonb_build_array(jsonb_build_object(
      'code', 'COMIDAS',
      'name', 'Comidas',
      'slots', (
        SELECT jsonb_agg(jsonb_build_object('name', meal->>'code', 'from', meal->>'from', 'to', meal->>'to', 'amount', meal->>'amount') ORDER BY ordinality)
        FROM jsonb_array_elements(config->'meals') WITH ORDINALITY AS meals(meal, ordinality)
      )
    ))),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'MEAL_ALLOWANCE' AND jsonb_typeof(config->'meals') = 'array';

-- The travel balance calculator is gone: a formula field does it (ADVANCE - SPENT) for any process.
DELETE FROM calculator_configs WHERE code = 'TRAVEL_BALANCE';

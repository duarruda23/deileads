-- Hotmart purchase payloads may include the DDD in checkout_phone as well
-- as checkout_phone_code. Older webhook code concatenated both fields.
-- Correct only unambiguous Brazilian numbers. A contact whose corrected
-- number already belongs to another contact needs a separate data merge;
-- updating it here would violate the account/phone unique index and could
-- split conversations or deals from their rightful contact.
WITH candidates AS (
  SELECT id, account_id,
         left(phone_normalized, 4) || substring(phone_normalized FROM 7) AS corrected,
         row_number() OVER (
           PARTITION BY account_id, left(phone_normalized, 4) || substring(phone_normalized FROM 7)
           ORDER BY created_at, id
         ) AS corrected_rank
  FROM contacts
  WHERE char_length(phone_normalized) IN (14, 15)
    AND phone_normalized ~ '^55[0-9]+$'
    AND substring(phone_normalized FROM 3 FOR 2) = substring(phone_normalized FROM 5 FOR 2)
), eligible AS (
  SELECT candidate.id, candidate.corrected
  FROM candidates candidate
  WHERE candidate.corrected_rank = 1
    AND NOT EXISTS (
      SELECT 1 FROM contacts existing
      WHERE existing.account_id = candidate.account_id
        AND existing.phone_normalized = candidate.corrected
    )
)
UPDATE contacts contact
SET phone = eligible.corrected,
    updated_at = now()
FROM eligible
WHERE contact.id = eligible.id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'player_connections_room_id_fkey'
          AND conrelid = 'player_connections'::regclass
    ) THEN
        ALTER TABLE player_connections
        DROP CONSTRAINT player_connections_room_id_fkey;
    END IF;

    ALTER TABLE player_connections
    ADD CONSTRAINT player_connections_room_id_fkey
    FOREIGN KEY (room_id)
    REFERENCES game_states(room_id)
    ON DELETE CASCADE;
END $$;

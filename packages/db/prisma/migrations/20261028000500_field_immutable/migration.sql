-- Fields that keep the value captured when the ticket was created, like the help desk's campo_inmutable (the dates,
-- concepts and meals of a trip): «Editar datos» does not offer them.
ALTER TABLE fields ADD COLUMN is_immutable boolean NOT NULL DEFAULT false;

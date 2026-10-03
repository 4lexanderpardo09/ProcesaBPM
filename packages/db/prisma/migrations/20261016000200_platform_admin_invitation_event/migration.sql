-- Inviting a platform administrator has its own e-mail: the password-reset one lasts minutes and is dropped if it waited an hour
-- in the queue, which is wrong for a person who may open the invitation days later.
INSERT INTO platform_event_types (type, description) VALUES
  ('email.platform_admin_invitation', 'Invitation to administer the platform; the payload carries only the user id, the worker issues the token');

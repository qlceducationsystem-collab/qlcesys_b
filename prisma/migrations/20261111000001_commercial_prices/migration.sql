UPDATE "ProductOffer" SET "name" = 'Herramientas financieras QLC', "description" = 'Acceso a todas las herramientas financieras de la plataforma durante 30 días.', "price" = 5, "currency" = 'USD', "accessDays" = 30 WHERE "code" = 'TOOLS_ALL';
UPDATE "ProductOffer" SET "name" = 'QLC Premium Access', "description" = 'Membresía anual integral: todas las herramientas y todos los módulos de la Masterclass durante 12 meses.', "price" = 60, "currency" = 'USDT', "accessDays" = 365 WHERE "code" = 'FULL_ANNUAL';
UPDATE "ProductOffer" SET "active" = false WHERE "code" = 'MASTERCLASS';

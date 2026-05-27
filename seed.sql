-- Seed with a small sample catalog so the app works without Rebrickable
INSERT INTO lego_sets (set_num, name, year, theme, pieces, minifigs, image_url, retail_price, current_value, forecast_2y, forecast_5y, retired, valuation_method)
VALUES
  ('75192-1', 'Millennium Falcon', 2017, 'Star Wars', 7541, 4, 'https://cdn.rebrickable.com/media/sets/75192-1/65519.jpg', 849.99, 1200.00, 1416.00, 1740.00, false, 'ai'),
  ('10300-1', 'Back to the Future Time Machine', 2022, 'Icons', 1872, 3, 'https://cdn.rebrickable.com/media/sets/10300-1/99048.jpg', 169.99, 225.00, 265.50, 326.25, false, 'ai'),
  ('42143-1', 'Ferrari Daytona SP3', 2022, 'Technic', 3778, 0, 'https://cdn.rebrickable.com/media/sets/42143-1/98862.jpg', 449.99, 580.00, 684.40, 841.00, false, 'ai'),
  ('21325-1', 'Medieval Blacksmith', 2021, 'Ideas', 2164, 4, 'https://cdn.rebrickable.com/media/sets/21325-1/89490.jpg', 179.99, 260.00, 306.80, 377.00, false, 'ai'),
  ('10281-1', 'Bonsai Tree', 2021, 'Icons', 878, 0, 'https://cdn.rebrickable.com/media/sets/10281-1/68064.jpg', 49.99, 75.00, 88.50, 108.75, false, 'ai'),
  ('31120-1', 'Medieval Castle', 2021, 'Creator 3-in-1', 1426, 4, 'https://cdn.rebrickable.com/media/sets/31120-1/94869.jpg', 99.99, 130.00, 153.40, 188.50, false, 'ai'),
  ('75257-1', 'Millennium Falcon', 2019, 'Star Wars', 1351, 7, 'https://cdn.rebrickable.com/media/sets/75257-1/72898.jpg', 169.99, 195.00, 230.10, 282.75, false, 'ai'),
  ('10290-1', 'Pickup Truck', 2021, 'Icons', 1677, 0, 'https://cdn.rebrickable.com/media/sets/10290-1/79553.jpg', 89.99, 110.00, 129.80, 159.50, false, 'ai'),
  ('21326-1', 'Winnie the Pooh', 2021, 'Ideas', 1265, 3, 'https://cdn.rebrickable.com/media/sets/21326-1/91832.jpg', 119.99, 180.00, 212.40, 261.00, true, 'ai'),
  ('75304-1', 'Darth Vader Helmet', 2021, 'Star Wars', 834, 0, 'https://cdn.rebrickable.com/media/sets/75304-1/93720.jpg', 69.99, 95.00, 112.10, 137.75, false, 'ai'),
  ('10268-1', 'Vestas Wind Turbine', 2018, 'Icons', 826, 0, 'https://cdn.rebrickable.com/media/sets/10268-1/59255.jpg', 199.99, 350.00, 413.00, 507.50, true, 'ai'),
  ('42096-1', 'Porsche 911 RSR', 2018, 'Technic', 1580, 0, 'https://cdn.rebrickable.com/media/sets/42096-1/58028.jpg', 129.99, 200.00, 236.00, 290.00, true, 'ai'),
  ('21340-1', 'Tales of the Space Age', 2023, 'Ideas', 688, 4, 'https://cdn.rebrickable.com/media/sets/21340-1/131413.jpg', 89.99, 100.00, 118.00, 145.00, false, 'ai'),
  ('60314-1', 'Ice Cream Truck Police Chase', 2022, 'City', 317, 4, 'https://cdn.rebrickable.com/media/sets/60314-1/100827.jpg', 29.99, 32.00, 37.76, 46.40, false, 'ai'),
  ('71741-1', 'NINJAGO City Gardens', 2021, 'Ninjago', 5685, 19, 'https://cdn.rebrickable.com/media/sets/71741-1/90344.jpg', 349.99, 520.00, 613.60, 754.00, false, 'ai')
ON CONFLICT (set_num) DO NOTHING;

INSERT INTO minifigs (fig_num, name, series, rarity, current_value, image_url)
VALUES
  ('col23-1', 'Viking', 'Series 23', 'uncommon', 8.50, 'https://cdn.rebrickable.com/media/sets/col23-1/93742.jpg'),
  ('col23-3', 'Ladybug Girl', 'Series 23', 'common', 5.00, 'https://cdn.rebrickable.com/media/sets/col23-3/92345.jpg'),
  ('col23-7', 'Space Police Guy', 'Series 23', 'rare', 18.00, 'https://cdn.rebrickable.com/media/sets/col23-7/95612.jpg'),
  ('col22-1', 'Beekeeper', 'Series 22', 'uncommon', 9.00, NULL),
  ('col22-12', 'Wolf Costume', 'Series 22', 'legendary', 35.00, NULL)
ON CONFLICT (fig_num) DO NOTHING;
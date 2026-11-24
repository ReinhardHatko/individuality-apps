# Copyright 2026 Parity Technologies (UK) Ltd.
# SPDX-License-Identifier: GPL-3.0-or-later

@paseo-play @paseo-game
Feature: A person signs up for one named live game on Paseo Next V2 and plays it
  For a run that names its game (a CI run with several hosts in it): the person waits for that
  game's sign-up, takes her seat, plays and her report is read from the chain. The others in her
  group are whoever signed up, the run's other bots among them.

  Scenario: Ada signs up for the run's game, plays it and her report is finalized
    Given Ada is a new actor
    And the next game is open for sign-up
    When Ada opens dim2 at /
    And Ada allows DIM2 its permissions
    And Ada registers for the game in DIM2
    And Ada plays the game and votes for the people she sees
    Then Ada's report of the game is finalized

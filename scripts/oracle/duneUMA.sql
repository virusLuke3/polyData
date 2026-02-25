WITH request_v2 AS (
    SELECT 
        evt_block_number, evt_block_time, evt_index, evt_tx_hash, 
        requester, 
        NULL AS proposer, NULL AS proposedPrice, NULL AS disputer, 
        NULL AS payout, NULL AS price,
        timestamp AS start_timestamp, NULL AS expiration_timestamp, ancillaryData
    FROM uma_polygon.OptimisticOracleV2_evt_RequestPrice
),

propose_v2 AS (
    SELECT 
        evt_block_number, evt_block_time, evt_index, evt_tx_hash, 
        requester, 
        proposer, proposedPrice, NULL AS disputer, 
        NULL AS payout, NULL AS price,
        timestamp AS start_timestamp, expirationTimestamp AS expiration_timestamp, ancillaryData
    FROM uma_polygon.OptimisticOracleV2_evt_ProposePrice
),

dispute_v2 AS (
    SELECT 
        evt_block_number, evt_block_time, evt_index, evt_tx_hash, 
        requester, 
        proposer, proposedPrice, disputer, 
        NULL AS payout, NULL AS price,
        timestamp AS start_timestamp, NULL AS expiration_timestamp, ancillaryData
    FROM uma_polygon.OptimisticOracleV2_evt_DisputePrice
),

settle_v2 AS (
    SELECT 
        evt_block_number, evt_block_time, evt_index, evt_tx_hash, 
        requester, 
        proposer, NULL AS proposedPrice, disputer, 
        payout, price,
        timestamp AS start_timestamp, NULL AS expiration_timestamp, ancillaryData
    FROM uma_polygon.OptimisticOracleV2_evt_Settle 
),

combine AS (
    SELECT *, 'request' AS label FROM request_v2
    UNION ALL
    SELECT *, 'propose' AS label FROM propose_v2
    UNION ALL
    SELECT *, 'dispute' AS label FROM dispute_v2
    UNION ALL
    SELECT *, 'settle' AS label FROM settle_v2
),

organize_combine AS (
    SELECT
        c.evt_block_number, c.evt_block_time, c.evt_index, c.evt_tx_hash, c.label,
        dims.conditionid, dims.questionid,
        c.requester, c.proposer, c.disputer, c.proposedPrice, c.price, c.payout,
        c.ancillaryData,
        from_utf8(c.ancillaryData) AS question_raw_text
    FROM combine c
    INNER JOIN query_2818960 AS dims 
        ON c.ancillaryData = dims.ancillarydata
)

SELECT 
    -- 1. 区块链底层核心字段复原
    evt_block_number AS block_number,
    evt_block_time AS "Event Time",
    evt_tx_hash AS tx_hash,
    label AS "Event Status",
    
    -- 2. Polymarket 映射外键复原
    conditionid,
    questionid,

    -- 3. ✅ 修复：加入 (?s) 使正则能够跨越换行符提取 Description
    regexp_extract(question_raw_text, '(?s)description:\s*(.*?)(?:\s*market_id:|$)', 1) AS "Description",

    -- 4. ✅ 恢复：P1 与 P2 解析字段
    CAST(regexp_extract(question_raw_text, 'p1:\s*([0-9]+)', 1) AS int) AS p1,
    CAST(regexp_extract(question_raw_text, 'p2:\s*([0-9]+)', 1) AS int) AS p2,

    -- 5. 预言机博弈角色提取 (横向铺开)
    MAX(requester) OVER(PARTITION BY questionid, ancillaryData) AS "Requester",
    MAX(proposer) OVER(PARTITION BY questionid, ancillaryData) AS "Proposer",
    MAX(disputer) OVER(PARTITION BY questionid, ancillaryData) AS "Disputer", -- ✅ 恢复了 Disputer
    MAX(proposer) OVER(PARTITION BY questionid, ancillaryData) AS "Settlement Recipient",

    -- 6. 生命周期交易哈希追踪 (完美复刻 UI)
    MAX(CASE WHEN label = 'request' THEN evt_tx_hash END) OVER(PARTITION BY questionid, ancillaryData) AS "Request Transaction",
    MAX(CASE WHEN label = 'propose' THEN evt_tx_hash END) OVER(PARTITION BY questionid, ancillaryData) AS "Proposal Transaction",
    MAX(CASE WHEN label = 'settle'  THEN evt_tx_hash END) OVER(PARTITION BY questionid, ancillaryData) AS "Settlement Transaction",

    -- 7. ✅ 恢复：价格与资金结果字段
    CASE 
        WHEN label IN ('propose', 'dispute') THEN proposedPrice / 1e18 
        ELSE NULL 
    END AS proposedprice,
    
    CASE 
        WHEN label = 'settle' THEN price / 1e18 
        ELSE NULL 
    END AS settledprice,
    
    payout, -- ✅ 恢复了 Payout 奖金字段

    -- 附上原文，方便与 UI 对账
    question_raw_text AS "String (Raw)"

FROM organize_combine
ORDER BY "Event Time" DESC
LIMIT 50;
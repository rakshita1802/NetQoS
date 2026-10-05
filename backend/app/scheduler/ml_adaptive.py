import time
import os
import numpy as np
import joblib
from sklearn.linear_model import SGDRegressor
from app.scheduler.wfq import WFQScheduler

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "netqos_ml_model.pkl")

class MLPredictiveScheduler(WFQScheduler):
    def __init__(self, high_q, med_q, low_q):
        super().__init__(high_q, med_q, low_q)
        self.last_adaptation = time.time()
        self.adaptation_reason = "ML Initializing..."
        
        # Machine Learning Model (Online Stochastic Gradient Descent Regressor)
        if os.path.exists(MODEL_PATH):
            try:
                self.model = joblib.load(MODEL_PATH)
                self.adaptation_reason = "ML Loaded from Memory!"
            except Exception:
                self.model = SGDRegressor(max_iter=1000, tol=1e-3)
        else:
            self.model = SGDRegressor(max_iter=1000, tol=1e-3)
            
        self.train_counter = 0
        
        # Feature history buffer: [throughput_change, current_latency] -> [next_latency]
        self.history_X = []
        self.history_y = []
        
        self.last_latency = 0.0
        self.last_time = time.time()
        
    def get_next_packet(self):
        current_time = time.time()
        
        # Every 2 seconds, evaluate and train the ML model
        if current_time - self.last_adaptation > 2.0:
            high_q_stats = self.high_q.get_stats()
            current_latency = high_q_stats['avg_wait_time']
            
            # Record data point for training
            time_delta = current_time - self.last_time
            self.history_X.append([time_delta, self.last_latency])
            self.history_y.append(current_latency)
                
            self.last_latency = current_latency
            self.last_time = current_time
            
            # Keep rolling window of last 20 data points
            if len(self.history_X) > 20:
                self.history_X.pop(0)
                self.history_y.pop(0)
                
            # Train the model online if we have enough data
            if len(self.history_X) >= 5:
                X = np.array(self.history_X)
                y = np.array(self.history_y)
                self.model.partial_fit(X, y)
                
                # Periodically save the model to disk (every 10 seconds / 5 fits)
                self.train_counter += 1
                if self.train_counter % 5 == 0:
                    try:
                        joblib.dump(self.model, MODEL_PATH)
                    except Exception as e:
                        print("Failed to save ML model:", e)
                
                # Predict what the latency will be in the NEXT 2 seconds
                next_pred = self.model.predict([[2.0, current_latency]])[0]
                
                # Proactive ML Adaptation
                if next_pred > 0.08: # If ML predicts latency will exceed 80ms
                    self.adaptation_reason = f"ML PROACTIVE: Predicted spike to {next_pred*1000:.1f}ms. Boosting High!"
                    self.weights = {"HIGH": 70, "MEDIUM": 20, "LOW": 10}
                elif current_latency < 0.03 and next_pred < 0.05:
                    self.adaptation_reason = f"ML Predicts stable ({next_pred*1000:.1f}ms). Restoring baseline."
                    self.weights = {"HIGH": 50, "MEDIUM": 30, "LOW": 20}
                else:
                    self.adaptation_reason = f"ML Monitoring... (Predicted next: {next_pred*1000:.1f}ms)"
            else:
                self.adaptation_reason = "ML Training on live data..."
                
            self.last_adaptation = current_time
            
        return super().get_next_packet()
        
    def get_stats(self):
        stats = super().get_stats()
        stats['last_adaptation_reason'] = self.adaptation_reason
        return stats
